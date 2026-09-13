# Deployment Guide for Render

This guide provides step-by-step instructions for deploying the Splitcore backend to Render using the included `render.yaml` Blueprint configuration.

## Problem Context

Render may default to using `npm install` as the build command instead of reading the configuration from `render.yaml`. This guide shows you how to properly configure Render to use the Blueprint specification, which includes the correct build command: `npm ci && npx prisma generate && npm run build`.

---

## Option 1: Deploy Using Render Blueprint (Recommended)

This is the preferred method as it uses the `render.yaml` file to automatically configure both the API service and worker service.

### Step 1: Connect Your Repository to Render

1. Log in to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** button in the top right
3. Select **"Blueprint"** from the dropdown menu
4. Connect your GitHub/GitLab repository (grant Render access if needed)
5. Select your `splitcore-backend` repository
6. Render will automatically detect the `render.yaml` file

### Step 2: Review Blueprint Configuration

Render will show you a preview of the services that will be created:

- **splitcore-api** (Web Service) - The NestJS API server
- **splitcore-worker** (Background Worker) - The BullMQ queue processor

Review the configuration and click **"Apply"** to proceed.

### Step 3: Configure Environment Variables

Before the first deployment, you need to set the environment variables that are marked as `sync: false` in the `render.yaml`. These must be configured manually in the Render dashboard.

#### For Both Services (API and Worker):

Navigate to each service in the Render dashboard and set the following environment variables:

**Required Variables:**

1. **DATABASE_URL** - PostgreSQL connection string from Supabase
   ```
   postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10
   ```
   - Replace `PASSWORD` with your Supabase database password
   - Replace `PROJECT_REF` with your Supabase project reference ID
   - The connection pooling parameters are already included

2. **REDIS_HOST** - Redis hostname from Upstash
   ```
   your-redis-instance.upstash.io
   ```

3. **REDIS_PASSWORD** - Redis password from Upstash
   ```
   your-redis-password-here
   ```

4. **SENTRY_DSN** - Sentry project DSN (Data Source Name)
   ```
   https://your-sentry-dsn@sentry.io/project-id
   ```

**Auto-Generated Variables:**

The following variables are automatically configured by the Blueprint:

- **JWT_SECRET** - Automatically generated secure random string (or set manually with 32+ characters)
- **NODE_ENV** - Set to `production`
- **PORT** - Set to `3000`
- **REDIS_PORT** - Set to `6379`
- **JWT_EXPIRES_IN** - Set to `7d`
- **SENTRY_TRACES_SAMPLE_RATE** - Set to `0.1` (10% sampling)
- **LOG_LEVEL** - Set to `info`

**Important:** Both the API service and Worker service must have **identical values** for `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `JWT_SECRET`.

### Step 4: Verify Build Commands

After the Blueprint is applied, verify that each service has the correct build command:

- **API Service (splitcore-api)**:
  - Build Command: `npm ci && npx prisma generate && npm run build`
  - Start Command: `npm run start:prod`
  
- **Worker Service (splitcore-worker)**:
  - Build Command: `npm ci && npx prisma generate && npm run build`
  - Start Command: `npm run start:worker:prod`

If these commands are incorrect, proceed to **Option 2** below to manually configure them.

### Step 5: Deploy and Monitor

1. Click **"Create Web Service"** and **"Create Worker"** to deploy both services
2. Render will automatically build and deploy your application
3. Monitor the deployment logs for any errors
4. The API service will be available at `https://splitcore-api.onrender.com` (or your custom domain)

### Step 6: Run Database Migrations

After the first successful deployment, run the Prisma migrations:

1. Navigate to the **splitcore-api** service in Render dashboard
2. Go to the **"Shell"** tab
3. Run the following commands:
   ```bash
   npx prisma migrate deploy
   npm run seed
   ```

This will create the database schema and seed an initial admin user.

---

## Option 2: Manual Service Configuration (Fallback)

If the Blueprint doesn't work or you need to manually configure the services, follow these steps:

### For API Service:

1. Go to Render Dashboard and click **"New +"** → **"Web Service"**
2. Connect your repository and select `splitcore-backend`
3. Configure the service:
   - **Name:** `splitcore-api`
   - **Region:** Oregon (or your preferred region)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm ci && npx prisma generate && npm run build`
   - **Start Command:** `npm run start:prod`
   - **Plan:** Starter (or your preferred plan)

4. Add the following environment variables (see Step 3 above for values):
   - `NODE_ENV=production`
   - `PORT=3000`
   - `DATABASE_URL` (set your Supabase connection string)
   - `REDIS_HOST` (set your Upstash hostname)
   - `REDIS_PORT=6379`
   - `REDIS_PASSWORD` (set your Upstash password)
   - `JWT_SECRET` (generate a secure random string, 32+ characters)
   - `JWT_EXPIRES_IN=7d`
   - `SENTRY_DSN` (set your Sentry DSN)
   - `SENTRY_TRACES_SAMPLE_RATE=0.1`
   - `LOG_LEVEL=info`

5. Configure Health Check:
   - **Health Check Path:** `/health`
   - Render will monitor this endpoint and restart the service if it fails

6. Click **"Create Web Service"**

### For Worker Service:

1. Go to Render Dashboard and click **"New +"** → **Background Worker**
2. Connect the same repository and select `splitcore-backend`
3. Configure the worker:
   - **Name:** `splitcore-worker`
   - **Region:** Oregon (must match API service region)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm ci && npx prisma generate && npm run build`
   - **Start Command:** `npm run start:worker:prod`
   - **Plan:** Starter (or your preferred plan)

4. Add the **same environment variables** as the API service (especially `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `JWT_SECRET`)

5. Click **"Create Background Worker"**

---

## Environment Variable Reference

Here's a complete reference of all required environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `production` | Environment mode (production/development) |
| `PORT` | Yes | `3000` | Port the API server listens on |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string from Supabase |
| `REDIS_HOST` | Yes | - | Redis hostname from Upstash |
| `REDIS_PORT` | Yes | `6379` | Redis port |
| `REDIS_PASSWORD` | Yes | - | Redis password from Upstash |
| `JWT_SECRET` | Yes | - | Secret key for JWT signing (min 32 chars) |
| `JWT_EXPIRES_IN` | Yes | `7d` | JWT token expiration time |
| `SENTRY_DSN` | Yes | - | Sentry project DSN for error tracking |
| `SENTRY_TRACES_SAMPLE_RATE` | Yes | `0.1` | Sentry performance monitoring sample rate (0.0-1.0) |
| `LOG_LEVEL` | Yes | `info` | Logging level (debug/info/warn/error) |

---

## Verifying Deployment

### 1. Check Health Endpoint

Once the API service is deployed, verify it's working:

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

If the database or Redis is "down", check your environment variables.

### 2. Check API Documentation

The interactive API documentation should be available at:

```
https://splitcore-api.onrender.com/api/docs
```

This Swagger UI page lets you explore and test all available endpoints.

### 3. Test Authentication

Test the authentication endpoint:

```bash
curl -X POST https://splitcore-api.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@splitcore.com",
    "password": "Admin123!"
  }'
```

Expected response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "...",
    "email": "admin@splitcore.com",
    "role": "ADMIN"
  }
}
```

### 4. Monitor Logs

Check the logs in Render Dashboard:

- Go to your service → **"Logs"** tab
- Look for startup messages confirming:
  - Database connection successful
  - Redis connection successful
  - Server listening on port 3000

### 5. Monitor Worker Process

For the worker service:

- Go to **splitcore-worker** → **"Logs"** tab
- Verify you see: `Worker started successfully`
- Check that jobs are being processed (if any are enqueued)

### 6. Check Sentry Integration

- Log in to your Sentry dashboard
- Navigate to your project
- You should see the backend service appear in the list
- Trigger a test error to verify error tracking is working

---

## Troubleshooting

### Build Command Not Found or Wrong

**Symptom:** Render uses `npm install` instead of the specified build command.

**Solution:**
1. Go to your service in Render Dashboard
2. Click **"Settings"** tab
3. Scroll to **"Build & Deploy"** section
4. Manually update the **Build Command** to:
   ```
   npm ci && npx prisma generate && npm run build
   ```
5. Save changes and trigger a manual deploy

### Database Connection Failed

**Symptom:** Health check shows database status as "down"

**Solution:**
1. Verify `DATABASE_URL` is correctly set in environment variables
2. Ensure the connection string includes `?sslmode=require&pgbouncer=true&connection_limit=10`
3. Test the connection string locally with `psql` or another PostgreSQL client
4. Check Supabase dashboard to ensure the database is running

### Redis Connection Failed

**Symptom:** Health check shows Redis status as "down"

**Solution:**
1. Verify `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` are correctly set
2. Test Redis connection using `redis-cli`:
   ```bash
   redis-cli -h your-redis-host -p 6379 -a your-password ping
   ```
3. Check Upstash dashboard to ensure Redis instance is active

### Worker Not Processing Jobs

**Symptom:** Jobs remain in the queue, worker logs show no activity

**Solution:**
1. Verify worker service is running (check status in Render Dashboard)
2. Ensure worker has the same `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` as API service
3. Check worker logs for connection errors
4. Restart the worker service

### Rate Limiting Triggered During Testing

**Symptom:** Receiving HTTP 429 (Too Many Requests) responses

**Solution:**
- Authentication endpoints are limited to 5 requests per 60 seconds per IP
- General endpoints are limited to 100 requests per 60 seconds per IP
- Wait for the rate limit window to reset or use different IPs for testing

### JWT Secret Mismatch

**Symptom:** Token validation fails, receiving 401 Unauthorized errors

**Solution:**
1. Ensure `JWT_SECRET` is identical in both API and Worker services
2. Verify the secret is at least 32 characters long
3. If you regenerated the secret, restart both services

### Migrations Not Applied

**Symptom:** Database queries fail, missing tables

**Solution:**
1. Connect to the API service shell in Render Dashboard
2. Run migrations manually:
   ```bash
   npx prisma migrate deploy
   ```
3. Verify migrations were applied successfully

---

## Continuous Deployment

Once configured, Render will automatically:

- Deploy new changes when you push to the `main` branch
- Run the build command on each deployment
- Restart services if health checks fail
- Keep both API and Worker services in sync

To disable auto-deployment:
1. Go to service **Settings** → **"Build & Deploy"**
2. Toggle **"Auto-Deploy"** to off
3. Manually trigger deployments from the dashboard when needed

---

## Updating render.yaml

If you need to modify the Blueprint configuration:

1. Update the `render.yaml` file in your repository
2. Commit and push changes to the `main` branch
3. Go to Render Dashboard → **"Blueprints"** → your blueprint
4. Click **"Sync"** to apply the changes
5. Review the changes and click **"Apply"**

**Note:** Changes to environment variables in `render.yaml` won't override manually set values in the dashboard. You need to update those separately.

---

## Production Checklist

Before going live with your production deployment, ensure:

- [ ] All environment variables are set correctly in Render Dashboard
- [ ] Database migrations have been applied (`npx prisma migrate deploy`)
- [ ] Admin user has been seeded (`npm run seed`)
- [ ] Health check endpoint returns 200 OK
- [ ] API documentation is accessible at `/api/docs`
- [ ] Authentication is working (test login endpoint)
- [ ] Worker service is running and processing jobs
- [ ] Sentry error tracking is configured and receiving events
- [ ] Custom domain is configured (if applicable)
- [ ] SSL/TLS certificates are active
- [ ] Rate limiting is enabled and tested
- [ ] CORS is configured with your frontend domain
- [ ] Log level is set to `info` or `warn` in production

---

## Additional Resources

- [Render Documentation](https://render.com/docs)
- [Render Blueprint Specification](https://render.com/docs/blueprint-spec)
- [Supabase Documentation](https://supabase.com/docs)
- [Upstash Redis Documentation](https://docs.upstash.com/redis)
- [Sentry Documentation](https://docs.sentry.io/)
- [NestJS Deployment Guide](https://docs.nestjs.com/faq/deployment)

---

## Support

If you encounter issues not covered in this guide:

1. Check the Render service logs for detailed error messages
2. Review the Render community forum: https://community.render.com/
3. Check Sentry for captured errors and stack traces
4. Verify all environment variables match the reference table above
