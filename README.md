# Lock In

Calorie, protein, sodium and added-sugar tracker for a fat-loss cut, with phone notifications:

- **8:00 am**: yesterday's summary
- **8:30 pm**: a check-in when you're short on protein or calories, with foods sized to close the gap

Runs entirely on Cloudflare: Workers (API, scheduled pushes), D1 (food log), static assets (the app).
AI features (type ingredients, photo scan, day review) are optional and use the Anthropic API.

## Deploy

```bash
npm install
npx wrangler d1 create lock-in            # copy the database_id into wrangler.toml
npm run db:init
npm run vapid                             # prints VAPID_PUBLIC_KEY and VAPID_PRIVATE_JWK
npx wrangler secret put APP_PASSCODE
npx wrangler secret put SESSION_SECRET
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_JWK
npx wrangler secret put VAPID_SUBJECT     # e.g. mailto:you@example.com
npx wrangler secret put ANTHROPIC_API_KEY # optional
npm run deploy
```

## Phone setup

- **iPhone (iOS 16.4+)**: open the site in Safari → Share → Add to Home Screen → open Lock In from the icon → Your plan → Turn on notifications.
- **Android**: open in Chrome → Install app → Turn on notifications.

## Times

Cron times in `wrangler.toml` are UTC. They're set for Bangkok (UTC+7). `TZ_OFFSET_MIN` and `DAY_START_HOUR` (the day runs 6 am to 6 am) are in `[vars]`.
