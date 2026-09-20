# Quick Render Deployment Setup

## Redis Configuration (Upstash)

Your Upstash Redis credentials:

```
REDIS_HOST=famous-griffon-165164.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=gQAAAAAAAoUsAAIgcDJhMTU4OTcyZjVlZDI0NWIzOTVmZDVjODZlMzM1NTZhOA
```

## Environment Variables Checklist

### splitcore-api service:

Go to Render Dashboard → splitcore-api → Environment tab and set:

- [x] `NODE_ENV` = `production` (auto-set)
- [x] `PORT` = `3000` (auto-set)
- [ ] `DATABASE_URL` = Your Supabase PostgreSQL connection string
- [x] `REDIS_HOST` = `famous-griffon-165164.upstash.io`
- [x] `REDIS_PORT` = `6379`
- [x] `REDIS_PASSWORD` = `gQAAAAAAAoUsAAIgcDJhMTU4OTcyZjVlZDI0NWIzOTVmZDVjODZlMzM1NTZhOA`
- [ ] `JWT_SECRET` = Auto-generated or set manually (min 32 chars)
- [x] `JWT_EXPIRES_IN` = `7d` (auto-set)
- [ ] `SENTRY_DSN` = Your Sentry project DSN (optional)
- [x] `SENTRY_TRACES_SAMPLE_RATE` = `0.1` (auto-set)
- [x] `LOG_LEVEL` = `info` (auto-set)

### splitcore-worker service (if deployed):

Must have the **same values** as API service for:
- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `JWT_SECRET`

## Deployment Order

1. ✅ Configure Redis credentials (above)
2. ⏳ Configure DATABASE_URL (Supabase)
3. ⏳ Configure SENTRY_DSN (optional)
4. ⏳ Save and trigger deployment
5. ⏳ Wait for deployment to complete
6. ⏳ Run database migrations via Render shell
7. ⏳ Test /health endpoint

## Quick Test

Once deployed, test the health endpoint:

```bash
curl https://splitcore-api.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "up",
  "redis": "up"
}
```

If Redis shows "up", your configuration is correct! ✅

## Need Help?

See comprehensive deployment guide: `docs/deployment/002-render-deployment.md`
