# Render Deployment Guide

This guide provides step-by-step instructions for deploying the Splitcore backend to Render.com, including both the API web service and the queue worker service.

## Overview

The Splitcore backend deploys as two separate services on Render:

- **API Web Service** - Handles HTTP requests, serves the REST API
- **Queue Worker Service** - Processes background jobs from Redis queue

Both services share the same codebase but have different start commands and scaling characteristics.

### Prerequisites

Before starting this deployment guide, ensure you have completed:

- ✅ [Infrastructure Setup Guide](./001-infrastructure-setup.md) - Supabase, Upstash, and Sentry configured
- ✅ GitHub repository with your Splitcore backend code
- ✅ Render account (free tier available at [https://render.com](https://render.com))
- ✅ All environment variable values from your infrastructure setup

---

## Deployment Options

Render supports two deployment methods:

1. **Blueprint Deployment** (Recommended) - Uses `render.yaml` to deploy both services automatically
2. **Manual Dashboard Deployment** - Create services one-by-one through the web interface

This guide covers **both methods**. Blueprint deployment is faster and easier to maintain, while manual deployment gives you more visibility into each configuration step.

---

## Option 1: Blueprint Deployment (Recommended)

Blueprint deployment uses the `render.yaml` file in your repository to automatically create and configure both services.

### Step 1: Prepare Your Repository

1. Ensure your repository contains the `render.yaml` file at the root
2. Verify the configuration matches your needs:
   ```bash
   cat render.yaml
   ```
3. Commit and push any pending changes:
   ```bash
   git add .
   git commit -m "Prepare for Render deployment"
   git push origin main
   ```

### Step 2: Connect GitHub to Render

1. Log in to [https://dashboard.render.com](https://dashboard.render.com)
2. If this is your first time, click **"New +"** dropdown in the top right
3. Select **"Blueprint"**
4. Click **"Connect GitHub"** (if not already connected)
5. Authorize Render to access your GitHub repositories
6. Select the organization/account containing your repository
7. Grant access to your Splitcore backend repository

### Step 3: Deploy Blueprint

1. After connecting GitHub, you'll see your repository in the list
2. Select your **splitcore-backend** repository
3. Render will detect the `render.yaml` file automatically
4. You'll see a blueprint preview showing:
   - **splitcore-api** (Web Service)
   - **splitcore-worker** (Worker Service)
5. Click **"Apply"** to create both services
6. Render will:
   - Create both services with the configurations from `render.yaml`
   - Install dependencies (`npm ci`)
   - Generate Prisma client
   - Build the application (`npm run build`)
   - **Note**: Initial deployment will fail because environment variables aren't set yet

### Step 4: Configure Environment Variables

After blueprint deployment creates the services, you need to set the environment variables that are marked `sync: false` in `render.yaml`.

#### For the API Service (splitcore-api)

1. In Render dashboard, navigate to **"Services"**
2. Click on **"splitcore-api"**
3. Click **"Environment"** in the left sidebar
4. Add/update the following environment variables:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `DATABASE_URL` | `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10&pool_timeout=20&connect_timeout=20` | Replace `[PASSWORD]` and `[PROJECT_REF]` with your Supabase values |
| `REDIS_HOST` | `your-instance.upstash.io` | From Upstash dashboard |
| `REDIS_PASSWORD` | `your-upstash-password` | From Upstash dashboard |
| `JWT_SECRET` | Auto-generated or set manually | Minimum 32 characters. Render can auto-generate secure values. |
| `SENTRY_DSN` | `https://[KEY]@o[ORG].ingest.us.sentry.io/[PROJECT]` | From Sentry project settings |

5. Click **"Save Changes"**
6. The service will automatically redeploy with the new environment variables

#### For the Worker Service (splitcore-worker)

1. Navigate back to **"Services"**
2. Click on **"splitcore-worker"**
3. Click **"Environment"** in the left sidebar
4. Add the **same environment variables** as the API service:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `DATABASE_URL` | Same as API service | Must match exactly |
| `REDIS_HOST` | Same as API service | Must match exactly |
| `REDIS_PASSWORD` | Same as API service | Must match exactly |
| `JWT_SECRET` | Same as API service | Must match exactly |
| `SENTRY_DSN` | Same as API service | Can be the same or separate Sentry project |

⚠️ **Critical**: The worker must have identical `DATABASE_URL`, `REDIS_HOST`, `REDIS_PASSWORD`, and `JWT_SECRET` values as the API service to communicate correctly.

5. Click **"Save Changes"**
6. The worker service will automatically redeploy

### Step 5: Verify Deployment

Both services should now be deploying. Monitor the deployment:

1. Click on **"splitcore-api"** service
2. Click **"Logs"** in the left sidebar
3. Watch for successful startup messages:
   ```
   Database connection established
   Splitcore backend listening on port 3000
   ```
4. Repeat for **"splitcore-worker"** service:
   ```
   Queue worker starting...
   Redis: your-instance.upstash.io:6379
   Queue worker ready to process jobs
   ```

### Step 6: Run Database Migrations

After the API service is running, execute database migrations:

1. In the **splitcore-api** service page, click **"Shell"** in the left sidebar
2. This opens a terminal connected to your running service
3. Run the migration command:
   ```bash
   npx prisma migrate deploy
   ```
4. Verify migrations completed successfully:
   ```
   ✓ Migrations applied successfully
   ```
5. (Optional) Seed the database with initial data:
   ```bash
   npx prisma db seed
   ```

✅ **Blueprint deployment complete!** Skip to [Health Check Verification](#health-check-verification) section.

---

## Option 2: Manual Dashboard Deployment

If you prefer to create services manually or want more control over each configuration step, follow this method.

### Step 1: Create the API Web Service

#### 1.1 Create New Web Service

1. Log in to [https://dashboard.render.com](https://dashboard.render.com)
2. Click **"New +"** in the top right
3. Select **"Web Service"**
4. Connect your GitHub repository (if not already connected):
   - Click **"Connect GitHub"**
   - Authorize Render
   - Select your repository: **splitcore-backend**
5. Click **"Connect"** next to your repository

#### 1.2 Configure Service Settings

Fill in the service configuration form:

| Field | Value |
|-------|-------|
| **Name** | `splitcore-api` |
| **Region** | `Oregon (US West)` (or closest to your users) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm ci --include=dev && npx prisma generate && npm run build` |
| **Start Command** | `npm run start:prod` |
| **Plan** | `Starter` (or higher based on needs) |

#### 1.3 Configure Advanced Settings

Click **"Advanced"** to expand additional options:

| Setting | Value |
|---------|-------|
| **Auto-Deploy** | ✅ Enabled (deploy on push to main) |
| **Health Check Path** | `/health` |
| **Environment** | `Node` |

#### 1.4 Configure Environment Variables

Scroll down to the **"Environment Variables"** section and add all variables:

##### Required Variables (Manual Entry)

| Variable Name | Value | Example |
|--------------|-------|---------|
| `NODE_ENV` | `production` | `production` |
| `PORT` | `3000` | `3000` |
| `DATABASE_URL` | Your Supabase connection string | `postgresql://postgres:password@db.abc123.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10` |
| `REDIS_HOST` | Your Upstash host | `us1-merry-bird-12345.upstash.io` |
| `REDIS_PORT` | `6379` | `6379` |
| `REDIS_PASSWORD` | Your Upstash password | `AabBcc123XYZ...` |
| `JWT_SECRET` | Generate secure random string (min 32 chars) | Click **"Generate"** button or use: `openssl rand -base64 32` |
| `JWT_EXPIRES_IN` | `7d` | `7d` |
| `SENTRY_DSN` | Your Sentry project DSN | `https://abc@o123.ingest.us.sentry.io/456` |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | `0.1` |
| `LOG_LEVEL` | `info` | `info` |

**Tips for entering variables:**

- Click **"Add Environment Variable"** for each entry
- Use the **"Generate"** button next to `JWT_SECRET` to create a secure value automatically
- Copy values directly from your infrastructure setup (Supabase, Upstash, Sentry dashboards)
- Double-check for typos - especially in connection strings

#### 1.5 Create Service

1. Review all settings
2. Click **"Create Web Service"** at the bottom
3. Render will start building and deploying your service
4. Initial build takes 3-5 minutes:
   - Installing dependencies
   - Generating Prisma client
   - Building TypeScript code
   - Starting the application

### Step 2: Create the Queue Worker Service

#### 2.1 Create New Worker Service

1. From Render dashboard, click **"New +"** again
2. This time, select **"Background Worker"**
3. Select the same repository: **splitcore-backend**
4. Click **"Connect"**

#### 2.2 Configure Worker Settings

Fill in the worker configuration form:

| Field | Value |
|-------|-------|
| **Name** | `splitcore-worker` |
| **Region** | `Oregon (US West)` (same as API service) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm ci --include=dev && npx prisma generate && npm run build` |
| **Start Command** | `npm run start:worker:prod` |
| **Plan** | `Starter` (or higher based on job volume) |

#### 2.3 Configure Worker Advanced Settings

Click **"Advanced"**:

| Setting | Value |
|---------|-------|
| **Auto-Deploy** | ✅ Enabled |
| **Environment** | `Node` |

⚠️ **Note**: Workers do not have health check paths (they don't serve HTTP traffic).

#### 2.4 Configure Worker Environment Variables

Add the **same environment variables** as the API service, plus worker-specific ones:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `NODE_ENV` | `production` | Same as API |
| `DATABASE_URL` | **Same as API service** | ⚠️ Must match exactly |
| `REDIS_HOST` | **Same as API service** | ⚠️ Must match exactly |
| `REDIS_PORT` | `6379` | Same as API |
| `REDIS_PASSWORD` | **Same as API service** | ⚠️ Must match exactly |
| `JWT_SECRET` | **Same as API service** | ⚠️ Must match exactly |
| `JWT_EXPIRES_IN` | `7d` | Same as API |
| `SENTRY_DSN` | **Same as API service** | Can use separate Sentry project if needed |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Same as API |
| `LOG_LEVEL` | `info` | Same as API |

⚠️ **Critical**: Copy the exact values from the API service. Any mismatch in `DATABASE_URL`, `REDIS_*`, or `JWT_SECRET` will cause communication failures.

**Pro tip**: Open the API service environment variables in another tab to copy-paste values accurately.

#### 2.5 Create Worker Service

1. Review all settings carefully
2. Click **"Create Background Worker"**
3. Render will build and deploy the worker
4. Build process is identical to API service (3-5 minutes)

### Step 3: Run Database Migrations

After the API service is running:

1. Go to **splitcore-api** service page
2. Click **"Shell"** in the left sidebar
3. Wait for the shell to connect
4. Run migrations:
   ```bash
   npx prisma migrate deploy
   ```
5. Expected output:
   ```
   Applying migration `20240101000000_init`
   Applying migration `20240102000000_add_users`
   ...
   ✓ All migrations applied successfully
   ```
6. (Optional) Seed initial data:
   ```bash
   npm run seed
   ```

### Step 4: Verify Deployment

Check that both services are running successfully:

#### Verify API Service

1. Navigate to **splitcore-api** service page
2. Click **"Logs"** tab
3. Look for successful startup messages:
   ```
   [INFO] Database connection established
   [INFO] Redis connection established  
   [INFO] Splitcore backend listening on port 3000
   ```
4. Check the service URL (top of the page):
   - Format: `https://splitcore-api.onrender.com`
5. Test the health endpoint:
   ```bash
   curl https://splitcore-api.onrender.com/health
   ```
6. Expected response:
   ```json
   {
     "status": "ok",
     "info": {
       "database": { "status": "up" },
       "redis": { "status": "up" }
     }
   }
   ```

#### Verify Worker Service

1. Navigate to **splitcore-worker** service page
2. Click **"Logs"** tab
3. Look for worker startup messages:
   ```
   [INFO] Queue worker starting...
   [INFO] Redis: us1-merry-bird-12345.upstash.io:6379
   [INFO] Environment: production
   [INFO] Queue worker ready to process jobs
   ```
4. No errors should appear in the logs
5. Worker should stay running (not crash-looping)

✅ **Manual deployment complete!** Continue to [Health Check Verification](#health-check-verification).

---

## Health Check Verification

After deployment (via either method), verify the health check endpoint is working correctly.

### Automatic Health Checks

Render automatically pings your health check endpoint every 60 seconds:

1. Navigate to **splitcore-api** service
2. Click **"Health & Alerts"** in the sidebar
3. You should see:
   - **Current Status**: ✅ Healthy
   - **Health Check Path**: `/health`
   - **Recent Checks**: List of successful pings (HTTP 200)
4. If health checks are failing:
   - Check logs for error messages
   - Verify database and Redis connections
   - See [Troubleshooting](#troubleshooting) section

### Manual Health Check Test

Test the health endpoint manually to verify all dependencies:

#### Using curl

```bash
curl -i https://your-service.onrender.com/health
```

**Expected Response:**

```http
HTTP/2 200
content-type: application/json; charset=utf-8

{
  "status": "ok",
  "info": {
    "database": {
      "status": "up"
    },
    "redis": {
      "status": "up"
    }
  },
  "error": {},
  "details": {
    "database": {
      "status": "up"
    },
    "redis": {
      "status": "up"
    }
  }
}
```

#### Using Browser

1. Copy your service URL from Render dashboard
2. Open in browser: `https://your-service.onrender.com/health`
3. You should see the JSON response above
4. Status should be `"ok"` with both dependencies `"up"`

### Health Check Failures

If the health check returns `503 Service Unavailable`:

**Example failure response:**

```json
{
  "status": "error",
  "info": {},
  "error": {
    "database": {
      "status": "down",
      "message": "Connection timeout"
    }
  }
}
```

**Troubleshooting steps:**

1. Check which dependency is down (`database` or `redis`)
2. Verify environment variables are set correctly
3. Check service logs for connection errors
4. Verify external services (Supabase/Upstash) are accessible
5. See [Troubleshooting](#troubleshooting) section for specific solutions

---

## CLI Deployment Examples

For automation or CI/CD integration, you can deploy using the Render CLI.

### Install Render CLI

```bash
# Install globally
npm install -g @render-cli/cli

# Or use npx without installing
npx @render-cli/cli --help
```

### Authenticate

```bash
# Login interactively
render login

# Or set API key
export RENDER_API_KEY=your-api-key
```

### Deploy Blueprint

```bash
# Deploy from render.yaml
render blueprint deploy

# Deploy specific blueprint by ID
render blueprint deploy --blueprint-id your-blueprint-id
```

### Deploy Individual Service

```bash
# Trigger manual deploy for API service
render service deploy --service-id srv-xxxxxxxxxxxxx

# Trigger manual deploy for worker service
render service deploy --service-id srv-yyyyyyyyyyyyy
```

### View Logs

```bash
# Follow logs for API service
render logs --service-id srv-xxxxxxxxxxxxx --follow

# View recent logs for worker
render logs --service-id srv-yyyyyyyyyyyyy --tail 100
```

### Update Environment Variables

```bash
# Set environment variable
render env set DATABASE_URL="postgresql://..." --service-id srv-xxxxxxxxxxxxx

# Set multiple variables from file
render env set --env-file .env.production --service-id srv-xxxxxxxxxxxxx
```

---

## Environment Variable Reference

Complete reference of all environment variables used by both services.

### Shared Variables (API + Worker)

These variables must have **identical values** on both services:

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `NODE_ENV` | string | Yes | - | Application environment (`production`, `development`, `test`) |
| `DATABASE_URL` | string | Yes | - | PostgreSQL connection string with pooling parameters |
| `REDIS_HOST` | string | Yes | - | Redis hostname from Upstash |
| `REDIS_PORT` | number | Yes | `6379` | Redis port (usually 6379 or 6380 for TLS) |
| `REDIS_PASSWORD` | string | Yes | - | Redis authentication password from Upstash |
| `JWT_SECRET` | string | Yes | - | Secret key for JWT signing (min 32 characters) |
| `JWT_EXPIRES_IN` | string | No | `7d` | JWT token expiration (e.g., `1d`, `7d`, `24h`) |
| `SENTRY_DSN` | string | No | - | Sentry project DSN for error tracking |
| `SENTRY_TRACES_SAMPLE_RATE` | number | No | `0.1` | Performance monitoring sample rate (0.0-1.0) |
| `LOG_LEVEL` | string | No | `info` | Logging level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) |

### API-Only Variables

These variables only apply to the web service:

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `PORT` | number | No | `3000` | HTTP port (Render sets this automatically) |

### Connection String Formats

#### DATABASE_URL Format

```
postgresql://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]?[PARAMETERS]
```

**Required Parameters:**
- `sslmode=require` - Enforces SSL connection (required by Supabase)
- `pgbouncer=true` - Enables PgBouncer connection pooling
- `connection_limit=10` - Maximum connections per instance
- `pool_timeout=20` - Connection timeout in seconds
- `connect_timeout=20` - Initial connection timeout

**Example:**
```
postgresql://postgres:MyPass123@db.abc123xyz.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10&pool_timeout=20&connect_timeout=20
```

#### REDIS Connection Format

Redis connection uses individual variables:

```bash
REDIS_HOST=us1-your-instance.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=AabBccDd123456...
```

**Note**: TLS is enabled automatically when connecting to Upstash hosts.

---

## Scaling and Performance

### Scaling the API Service

Render automatically handles scaling based on your plan:

**Starter Plan:**
- Single instance
- Auto-restart on failure
- Basic monitoring

**Standard Plan and above:**
- Multiple instances (2+ for high availability)
- Load balancing across instances
- Advanced monitoring and metrics

**To scale manually:**

1. Go to **splitcore-api** service
2. Click **"Settings"**
3. Under **"Scaling"**, adjust:
   - **Instance Count**: Number of parallel instances (Standard+ plans)
   - **Instance Type**: CPU and memory allocation
4. Click **"Save Changes"**

**Recommendations:**
- **Development/Staging**: 1 instance, Starter plan
- **Production (low traffic)**: 2 instances, Standard plan (high availability)
- **Production (high traffic)**: 3+ instances, Pro plan with auto-scaling

### Scaling the Worker Service

Worker scaling depends on queue job volume:

**Scaling considerations:**
- **Low job volume** (< 100 jobs/hour): 1 worker instance
- **Medium job volume** (100-1000 jobs/hour): 2-3 worker instances
- **High job volume** (1000+ jobs/hour): 4+ workers or dedicated plan

**To scale workers:**

1. Go to **splitcore-worker** service
2. Click **"Settings"**
3. Adjust instance count based on job backlog
4. Monitor Redis queue metrics in Upstash dashboard

**Note**: All worker instances share the same Redis queue, so jobs are distributed automatically.

### Performance Optimization

**Database Connection Pooling:**
- PgBouncer is enabled via `pgbouncer=true` in `DATABASE_URL`
- Connection limit is 10 per instance (adjust based on traffic)
- Prisma automatically manages pooling

**Redis Optimization:**
- Regional Upstash database reduces latency
- Connection reuse (BullMQ maintains persistent connections)
- Job processing is concurrent within each worker

**Monitoring Performance:**
- Check **"Metrics"** tab in Render for CPU/Memory usage
- Monitor Sentry **"Performance"** section for slow endpoints
- Watch Upstash **"Metrics"** for Redis throughput

---

## Monitoring and Alerts

### Built-in Render Monitoring

**Access Metrics:**

1. Navigate to your service (API or Worker)
2. Click **"Metrics"** in the sidebar
3. View real-time graphs:
   - CPU usage
   - Memory usage
   - Request rate (API only)
   - Response time (API only)
   - Instance count

**Set Up Alerts:**

1. Go to **"Settings"** → **"Alerts"**
2. Configure alert thresholds:
   - High CPU usage (> 80%)
   - High memory usage (> 90%)
   - Service restarts (> 3 in 1 hour)
   - Health check failures
3. Add notification channels:
   - Email
   - Slack webhook
   - PagerDuty integration

### Sentry Monitoring

**View Errors:**

1. Log in to [https://sentry.io](https://sentry.io)
2. Navigate to your **splitcore-backend** project
3. Check **"Issues"** for captured errors
4. Review stack traces, user context, and request data

**Performance Monitoring:**

1. Click **"Performance"** in Sentry
2. View transaction durations:
   - Slow endpoints (> 1 second)
   - Database query performance
   - External API calls
3. Optimize slow transactions based on data

**Configure Alerts:**

1. Go to **"Alerts"** → **"Create Alert"**
2. Set conditions:
   - Error rate exceeds threshold
   - Response time degrades
   - New error types appear
3. Add notification integrations (Slack, email, PagerDuty)

### Log Aggregation

**View Logs in Render:**

1. Navigate to service
2. Click **"Logs"**
3. Filter by:
   - Log level (error, warn, info)
   - Time range
   - Search keywords
4. Download logs for analysis

**External Log Management (Optional):**

For production systems, consider integrating with:
- **Datadog** - Full observability platform
- **Loggly** - Log aggregation and search
- **Papertrail** - Real-time log tailing and alerts

---

## Troubleshooting

### Common Deployment Issues

#### Issue: Build Failed - "Cannot find module"

**Symptoms:**
```
Error: Cannot find module '@nestjs/core'
npm ERR! missing: @nestjs/core@^10.0.0
```

**Solutions:**
1. Verify `package.json` includes all dependencies
2. Check build command includes `npm ci` (not `npm install`)
3. Clear build cache:
   - Go to **"Settings"** → **"Build & Deploy"**
   - Click **"Clear build cache"**
   - Trigger manual deploy

#### Issue: Prisma Client Generation Failed

**Symptoms:**
```
Error: @prisma/client did not initialize yet
```

**Solutions:**
1. Verify build command includes `npx prisma generate`
2. Check `prisma/schema.prisma` file exists and is valid
3. Ensure `DATABASE_URL` is set (required for generation)
4. Correct build command order:
   ```bash
   npm ci --include=dev && npx prisma generate && npm run build
   ```

#### Issue: Database Connection Timeout

**Symptoms:**
```
Error: Can't reach database server at db.xxx.supabase.co:5432
P1001: Connection timeout
```

**Solutions:**
1. Verify `DATABASE_URL` is correctly formatted
2. Check Supabase service is running (visit Supabase dashboard)
3. Confirm `sslmode=require` is in connection string
4. Test connection locally with same credentials
5. Increase `connect_timeout` parameter to 30 seconds

#### Issue: Redis Connection Failed

**Symptoms:**
```
Error: connect ECONNREFUSED
Redis connection failed: Connection timeout
```

**Solutions:**
1. Verify `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` are correct
2. Check Upstash Redis instance is active (visit Upstash dashboard)
3. Ensure TLS is enabled on Upstash instance
4. Test connection using Upstash CLI or dashboard
5. Verify no typos in environment variables (especially password)

#### Issue: JWT Secret Too Short

**Symptoms:**
```
Error: JWT_SECRET must be at least 32 characters long
Application failed to start
```

**Solutions:**
1. Generate a new secure secret:
   ```bash
   openssl rand -base64 32
   ```
2. Or use Render's auto-generate feature:
   - Edit `JWT_SECRET` environment variable
   - Click **"Generate"** button
3. Update both API and worker services with same value

#### Issue: Health Check Failing

**Symptoms:**
- Service shows as "Unhealthy" in Render
- Frequent restarts
- 503 errors when accessing API

**Solutions:**
1. Check logs for errors during startup
2. Verify `/health` endpoint is accessible:
   ```bash
   curl https://your-service.onrender.com/health
   ```
3. Ensure database and Redis connections succeed
4. Temporarily increase health check timeout in service settings
5. Check if service is starting before health check timeout (default 60s)

#### Issue: Worker Not Processing Jobs

**Symptoms:**
- Jobs stay in queue indefinitely
- No processing logs from worker
- Upstash shows queued jobs but no activity

**Solutions:**
1. Verify worker service is running (check logs)
2. Confirm worker has same `REDIS_*` variables as API
3. Check worker logs for connection errors
4. Ensure worker start command is correct: `npm run start:worker:prod`
5. Test enqueueing a job from API and watch worker logs
6. Verify BullMQ queue names match between API and worker

#### Issue: Environment Variables Not Applied

**Symptoms:**
```
Error: DATABASE_URL is required
Environment validation failed
```

**Solutions:**
1. Verify variables are saved in Render dashboard
2. Click **"Save Changes"** after editing variables
3. Manually trigger a redeploy:
   - Go to **"Manual Deploy"**
   - Click **"Deploy latest commit"**
4. Check for typos in variable names (case-sensitive)
5. Ensure no trailing spaces in variable values

#### Issue: Slow Performance / Timeouts

**Symptoms:**
- Requests take > 5 seconds
- Frequent 504 Gateway Timeout errors
- High CPU/memory usage

**Solutions:**
1. Check Render **"Metrics"** for resource usage
2. Upgrade instance type if CPU/memory is maxed
3. Optimize database queries (check Prisma query logs)
4. Reduce `SENTRY_TRACES_SAMPLE_RATE` to lower overhead
5. Enable Prisma query logging to find slow queries
6. Consider scaling to multiple instances
7. Check external service latency (Supabase, Upstash)

---

## Production Checklist

Before going live with production traffic, verify the following:

### Pre-Deployment

- [ ] All infrastructure services are set up and tested (Supabase, Upstash, Sentry)
- [ ] Environment variables are documented and backed up securely
- [ ] Database migrations are tested in staging environment
- [ ] API endpoints are tested with realistic data
- [ ] Queue jobs are tested end-to-end
- [ ] Load testing completed for expected traffic
- [ ] Security review completed (secrets, CORS, rate limiting)

### Deployment Configuration

- [ ] Both services deployed successfully (API + Worker)
- [ ] Health check endpoint returning 200 OK
- [ ] All environment variables set correctly on both services
- [ ] `DATABASE_URL` includes connection pooling parameters
- [ ] `JWT_SECRET` is secure (min 32 characters) and matches on both services
- [ ] `SENTRY_DSN` is configured and capturing errors
- [ ] Auto-deploy enabled on `main` branch
- [ ] Service regions match (API and Worker in same region)

### Post-Deployment

- [ ] Database migrations applied successfully
- [ ] Initial admin user seeded (if applicable)
- [ ] Test authentication flow (login, token refresh)
- [ ] Test protected endpoints with valid/invalid tokens
- [ ] Enqueue and process at least one background job
- [ ] Verify Sentry is receiving error reports
- [ ] Check all services are healthy in monitoring dashboards
- [ ] Test rate limiting (verify 429 responses work)
- [ ] Verify CORS policy allows only intended origins
- [ ] API documentation accessible (if using Swagger at `/api/docs`)

### Monitoring and Alerts

- [ ] Render health check alerts configured
- [ ] Sentry error alerts configured
- [ ] Slack/email notifications working
- [ ] Uptime monitoring enabled (e.g., via UptimeRobot, Pingdom)
- [ ] Log retention policy configured
- [ ] Metrics dashboards reviewed and bookmarked

### Security

- [ ] All secrets are set as environment variables (not in code)
- [ ] `.env` files are in `.gitignore`
- [ ] Supabase connection uses SSL (`sslmode=require`)
- [ ] Upstash Redis uses TLS
- [ ] JWT secrets are strong and unique per environment
- [ ] Sentry filters sensitive data (passwords, tokens, PII)
- [ ] Rate limiting is active and tested
- [ ] CORS origins are restricted to known domains

### Documentation

- [ ] Deployment runbook is up to date
- [ ] Rollback procedure documented
- [ ] On-call escalation process defined
- [ ] Architecture diagrams reflect production setup
- [ ] Environment variable reference is complete

---

## Next Steps

After successful deployment:

1. **Database Migrations** - Follow [003-database-migrations.md](./003-database-migrations.md) for migration management
2. **Troubleshooting** - Refer to [004-troubleshooting.md](./004-troubleshooting.md) for common production issues
3. **Monitoring** - Set up alerts and dashboards for production observability
4. **Scaling** - Plan scaling strategy based on traffic patterns
5. **Backup and Recovery** - Implement backup procedures for database and Redis

---

## Additional Resources

### Render Documentation
- [Render Deploy Hooks](https://render.com/docs/deploy-hooks)
- [Render Environment Variables](https://render.com/docs/environment-variables)
- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Render CLI](https://render.com/docs/cli)

### Splitcore Documentation
- [Architecture Overview](../architecture/001-system-overview.md)
- [Authentication Flow](../architecture/003-authentication-flow.md)
- [Queue Processing](../architecture/005-queue-processing.md)

### External Services
- [Supabase Documentation](https://supabase.com/docs)
- [Upstash Documentation](https://docs.upstash.com)
- [Sentry Documentation](https://docs.sentry.io)

---

**Documentation Version**: 1.0  
**Last Updated**: 2024-01-15  
**Maintained By**: Splitcore Backend Team
