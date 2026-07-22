# Getting Started with [Fastify-CLI](https://www.npmjs.com/package/fastify-cli)

This project was bootstrapped with Fastify-CLI.

## Available Scripts

In the project directory, you can run:

### `npm run dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `npm start`

For production mode

### `npm run test`

Run the test cases.

### Airtable → Postgres import

Requires `AIRTABLE_API_KEY` (scope `data.records:read`), `AIRTABLE_BASE_ID`, and `DATABASE_URL`.

```bash
npx prisma migrate deploy
npm run airtable:import:dry   # report only
npm run airtable:import       # upsert into Postgres
```

## Learn More

To learn Fastify, check out the [Fastify documentation](https://fastify.dev/docs/latest/).
