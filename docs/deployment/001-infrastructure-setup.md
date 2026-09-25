# Infrastructure Setup Guide

This guide provides step-by-step instructions for setting up the external infrastructure services required for deploying the Splitcore backend to production.

## Overview

The Splitcore backend requires the following external services:

- **Supabase PostgreSQL** - Primary database with PgBouncer connection pooling
- **Upstash Redis** - Cache and queue management
- **Sentry** - Error tracking and performance monitoring

Each service can be set up independently. Complete all three setups before proceeding with Render deployment.

---

## 1. Supabase PostgreSQL Setup

Supabase provides managed PostgreSQL with connection pooling via PgBouncer, making it ideal for serverless and production deployments.

### Prerequisites

- Supabase account (free tier available at [https://supabase.com](https://supabase.com))
- Email address for account verification

### Step-by-Step Instructions

#### Step 1: Create Supabase Account and Project

1. Navigate to [https://supabase.com](https://supabase.com)
2. Click **"Start your project"** or **"Sign in"** if you have an account
3. Sign in using GitHub, GitLab, or email
4. Once logged in, click **"New project"** from your dashboard
5. Fill in the project details:
   - **Project name**: `splitcore-backend-prod` (or your preferred name)
   - **Database password**: Generate a strong password (save this securely - you'll need it later)
   - **Region**: Choose the region closest to your Render deployment (e.g., `us-east-1` or `us-west-1`)
   - **Pricing plan**: Select appropriate tier (Free tier works for development)
6. Click **"Create new project"**
7. Wait 2-3 minutes for the project to be provisioned

#### Step 2: Retrieve Database Connection Details

1. From your project dashboard, click **"Settings"** in the left sidebar
2. Navigate to **"Database"** under Project Settings
3. Scroll to the **"Connection string"** section
4. Select the **"URI"** tab to see the full connection string format
5. Copy the **"Connection pooling"** connection string (this uses PgBouncer)
   - It should look like: `postgresql://postgres.your-project-ref:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
6. Note your **Project Reference ID** (visible in the connection string as `your-project-ref`)

#### Step 3: Configure Connection String for Production

The production database URL requires specific query parameters for optimal connection pooling:

```
postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10&pool_timeout=20&connect_timeout=20
```

**Parameter explanations:**

- `sslmode=require` - SSL is mandatory for Supabase connections (security requirement)
- `pgbouncer=true` - Uses PgBouncer connection pooler for efficient connection management
- `connection_limit=10` - Maximum concurrent connections (matches Prisma pool configuration)
- `pool_timeout=20` - Connection acquisition timeout in seconds
- `connect_timeout=20` - Initial connection timeout in seconds

**Example:**
```
postgresql://postgres:__DB_PASSWORD__@db.__PROJECT_REF__.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=10&pool_timeout=20&connect_timeout=20
```

#### Step 4: Enable Required Extensions (Optional)

Supabase comes with common PostgreSQL extensions pre-installed. If your application requires specific extensions:

1. Navigate to **"Database"** in the left sidebar
2. Click **"Extensions"** tab
3. Search for and enable any required extensions (e.g., `uuid-ossp`, `pgcrypto`)
4. Extensions are enabled immediately without restart

### Verification Criteria

Verify your Supabase database setup is successful:

✅ **Connection Test via SQL Editor**
1. In Supabase dashboard, navigate to **"SQL Editor"**
2. Run the following query:
   ```sql
   SELECT version();
   ```
3. You should see PostgreSQL version information returned (e.g., `PostgreSQL 15.x...`)

✅ **Connection Test via Local Environment**
1. Copy your formatted connection string
2. Add it to a local `.env` file as `DATABASE_URL`
3. Run database migration:
   ```bash
   npx prisma migrate deploy
   ```
4. Successful migration indicates database is accessible and properly configured

✅ **Connection Pooling Verification**
1. In the Supabase dashboard, go to **"Settings"** → **"Database"**
2. Verify **"Connection pooling"** shows as enabled
3. Default pool mode should be **"Transaction"** (recommended for serverless)

✅ **Security Verification**
1. Verify SSL is enforced: Try connecting without `sslmode=require` (should fail)
2. Check Row Level Security (RLS) status in **"Authentication"** → **"Policies"**
3. For production, consider enabling RLS on sensitive tables

### Troubleshooting Common Issues

**Issue: "Connection timeout" error**
- **Solution**: Verify your IP isn't blocked. Supabase allows all IPs by default, but check **"Settings"** → **"Database"** → **"Connection Pooling"** settings
- Increase `connect_timeout` parameter to 30 seconds

**Issue: "Too many connections" error**
- **Solution**: Reduce `connection_limit` parameter to 5-7 connections per instance
- Verify you're using the PgBouncer connection string (not direct connection)

**Issue: "SSL required" error**
- **Solution**: Ensure `sslmode=require` is present in the connection string
- Supabase requires SSL for all connections

**Issue: Migration fails with "database does not exist"**
- **Solution**: Supabase creates `postgres` database by default. Don't try to create a custom database
- Use the default `postgres` database provided

---

## 2. Upstash Redis Setup

Upstash provides serverless Redis with pay-per-request pricing and global edge caching, ideal for queue management and caching.

### Prerequisites

- Upstash account (free tier available at [https://upstash.com](https://upstash.com))
- Email address for account verification

### Step-by-Step Instructions

#### Step 1: Create Upstash Account and Database

1. Navigate to [https://upstash.com](https://upstash.com)
2. Click **"Get Started"** or **"Login"**
3. Sign up using GitHub, Google, or email
4. After email verification, you'll be redirected to the dashboard
5. Click **"Create Database"** button
6. Configure your Redis database:
   - **Name**: `splitcore-redis-prod` (or your preferred name)
   - **Type**: Select **"Regional"** for predictable latency (recommended for queue processing)
   - **Region**: Choose the same region as your Render deployment (e.g., `us-east-1`)
   - **TLS**: Keep **enabled** (default and recommended)
   - **Eviction**: Select **"No eviction"** (important for queue reliability)
7. Click **"Create"**
8. Database will be ready in a few seconds

#### Step 2: Retrieve Redis Connection Details

1. From your Upstash dashboard, click on your newly created database
2. You'll see the database details page with connection information
3. Copy the following values (you'll need these for environment variables):
   - **Endpoint**: The Redis host (e.g., `us1-merry-bird-12345.upstash.io`)
   - **Port**: Usually `6379` (standard Redis port) or `6380` (TLS port)
   - **Password**: Your Redis password (click the eye icon to reveal)

#### Step 3: Configure REST API (Optional but Recommended)

Upstash provides both Redis protocol and REST API access:

1. On your database details page, scroll to **"REST API"** section
2. Note the **REST URL** and **REST Token** for HTTP-based access (useful for debugging)
3. For this application, we'll use the standard Redis protocol via **Endpoint** and **Password**

#### Step 4: Configure Environment Variables

Set up your environment variables with the connection details:

```bash
REDIS_HOST=us1-merry-bird-12345.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password-here
```

**Important Notes:**

- Use the **TLS/SSL port** (usually `6379` or `6380`) for encrypted connections
- The password is required - Upstash Redis is not publicly accessible without authentication
- Keep the password secure and never commit it to version control

### Verification Criteria

Verify your Upstash Redis setup is successful:

✅ **Connection Test via Upstash Console**
1. In your database details page, click **"CLI"** tab
2. This opens an interactive Redis CLI in your browser
3. Run the following commands:
   ```redis
   PING
   ```
   Expected response: `PONG`
   
   ```redis
   SET test-key "Hello Upstash"
   GET test-key
   ```
   Expected response: `"Hello Upstash"`
   
   ```redis
   DEL test-key
   ```
4. All commands should execute successfully

✅ **Connection Test via Local Environment**
1. Add your Upstash credentials to local `.env` file
2. Start your application locally:
   ```bash
   npm run start:dev
   ```
3. Check logs for Redis connection success message
4. Test queue operations by triggering a background job
5. Monitor the Upstash dashboard - you should see metrics updating

✅ **Performance Verification**
1. In Upstash dashboard, navigate to **"Metrics"** tab
2. Verify the following metrics are visible:
   - **Commands per second**: Should show activity during testing
   - **Latency**: Should be under 50ms for regional setup
   - **Memory usage**: Should show current usage
3. Run a load test if needed to verify throughput

✅ **Queue Processing Verification**
1. Enqueue a test job from your application
2. In Upstash CLI, run:
   ```redis
   KEYS bull:*
   ```
3. You should see BullMQ queue keys
4. Verify the queue worker processes the job successfully

✅ **Persistence Verification**
1. Add a test key:
   ```redis
   SET persistent-test "data"
   ```
2. Wait 1 minute
3. Retrieve the key:
   ```redis
   GET persistent-test
   ```
4. Data should persist (confirming "No eviction" policy is working)

### Troubleshooting Common Issues

**Issue: "Connection refused" or timeout errors**
- **Solution**: Verify you're using the correct endpoint from Upstash dashboard
- Check that your application can make outbound connections to Upstash (firewall rules)
- Ensure you're using the TLS-enabled port

**Issue: "Authentication failed" error**
- **Solution**: Double-check the password from Upstash dashboard (copy carefully)
- Ensure no extra spaces or characters in the password environment variable
- Try regenerating the password from Upstash dashboard if issues persist

**Issue: Keys disappearing or being evicted**
- **Solution**: Verify eviction policy is set to **"No eviction"**
- Check database details → **"Configuration"** → **"Eviction Policy"**
- Change to "noeviction" to prevent key expiration

**Issue: High latency (>100ms)**
- **Solution**: Verify your Upstash region matches your Render deployment region
- Consider upgrading to regional database if using global tier
- Check Upstash status page for any ongoing issues

**Issue: BullMQ jobs stuck in queue**
- **Solution**: Verify queue worker process is running
- Check worker logs for connection errors
- Ensure REDIS_HOST, REDIS_PORT, and REDIS_PASSWORD are correctly set on worker service
- Test Redis connection from worker using `redis-cli` or application health check

---

## 3. Sentry Project Setup

Sentry provides error tracking, performance monitoring, and alerting for production applications.

### Prerequisites

- Sentry account (free tier available at [https://sentry.io](https://sentry.io))
- Email address for account verification

### Step-by-Step Instructions

#### Step 1: Create Sentry Account and Organization

1. Navigate to [https://sentry.io/signup](https://sentry.io/signup)
2. Sign up using GitHub, GitLab, Google, or email
3. After verification, complete the onboarding:
   - **Organization name**: Your company or project name (e.g., `Splitcore`)
   - **Team name**: Default team name (e.g., `Backend Team`)
4. Click **"Continue"** to proceed to project creation

#### Step 2: Create Sentry Project

1. On the "Create a Project" screen, configure:
   - **Platform**: Select **"Node.js"** (NestJS runs on Node.js)
   - **Set your alert frequency**: Choose **"Alert me on every new issue"** (recommended for production)
   - **Project name**: `splitcore-backend` (or your preferred name)
2. Click **"Create Project"**
3. You'll be redirected to the project setup page

#### Step 3: Retrieve Sentry DSN

1. After project creation, you'll see installation instructions
2. Scroll to find your **DSN (Data Source Name)**
3. The DSN format looks like:
   ```
   https://[PUBLIC_KEY]@o[ORG_ID].ingest.us.sentry.io/[PROJECT_ID]
   ```
   Example:
   ```
   https://__PUBLIC_KEY__@__ORG_ID__.ingest.us.sentry.io/__PROJECT_ID__
   ```
4. Copy this DSN - you'll need it for the `SENTRY_DSN` environment variable
5. If you navigate away, you can always find the DSN at:
   - **Settings** → **Projects** → Select your project → **Client Keys (DSN)**

#### Step 4: Configure Performance Monitoring

1. In your Sentry project, navigate to **"Settings"**
2. Click **"Performance"** in the left sidebar
3. Enable **"Enable Performance Monitoring"** toggle
4. Set **"Transactions Sample Rate"**:
   - **Development/Staging**: `1.0` (100% of transactions)
   - **Production**: `0.1` (10% of transactions - reduces quota usage)
5. Click **"Save Changes"**

#### Step 5: Configure Alert Rules (Optional but Recommended)

1. Navigate to **"Alerts"** in the left sidebar
2. Click **"Create Alert"**
3. Set up a basic alert rule:
   - **Alert name**: "High Error Rate"
   - **Environment**: Production
   - **Conditions**: When error count exceeds 10 in 1 hour
   - **Actions**: Send notification to email/Slack
4. Click **"Save Rule"**
5. Repeat for other important alerts (e.g., slow response times, memory issues)

#### Step 6: Configure Environment Variables

Set up your Sentry environment variables:

```bash
SENTRY_DSN=https://__PUBLIC_KEY__@__ORG_ID__.ingest.us.sentry.io/__PROJECT_ID__
SENTRY_TRACES_SAMPLE_RATE=0.1
```

**Parameter explanations:**

- `SENTRY_DSN` - Your unique project identifier for sending error reports
- `SENTRY_TRACES_SAMPLE_RATE` - Percentage of transactions to track (0.0-1.0)
  - `0.1` = 10% of requests (recommended for production)
  - `1.0` = 100% of requests (use for development/staging only)

#### Step 7: Set Up Releases (Optional but Recommended)

Releases help track which version of your code caused errors:

1. Install Sentry CLI:
   ```bash
   npm install --save-dev @sentry/cli
   ```
2. Create a `.sentryclirc` file in your project root:
   ```ini
   [defaults]
   project=splitcore-backend
   org=your-org-name
   
   [auth]
   token=your-auth-token
   ```
3. Add release creation to your deployment script:
   ```bash
   npx sentry-cli releases new "$RENDER_GIT_COMMIT"
   npx sentry-cli releases finalize "$RENDER_GIT_COMMIT"
   ```

### Verification Criteria

Verify your Sentry project setup is successful:

✅ **DSN Connection Test**
1. Add Sentry DSN to your local `.env` file
2. Start your application:
   ```bash
   npm run start:dev
   ```
3. Check application logs for Sentry initialization message
4. No errors should appear related to Sentry configuration

✅ **Error Capture Test**
1. With your app running locally, trigger a test error:
   ```typescript
   // Add this temporarily to a controller for testing
   @Get('test-error')
   testError() {
     throw new Error('Sentry test error - ignore this');
   }
   ```
2. Make a request to the endpoint: `GET http://localhost:3000/test-error`
3. Navigate to your Sentry project dashboard
4. Within 1-2 minutes, you should see the error appear in **"Issues"**
5. Click on the issue to verify:
   - Stack trace is captured
   - Request context is included
   - Environment is set correctly

✅ **Performance Monitoring Test**
1. Ensure `SENTRY_TRACES_SAMPLE_RATE` is set to `1.0` for testing
2. Make several requests to your API endpoints
3. Navigate to **"Performance"** in Sentry dashboard
4. You should see transaction data appearing:
   - HTTP request durations
   - Database query performance
   - Endpoint breakdown
5. Verify slow transactions are highlighted (if any exceed thresholds)

✅ **Sensitive Data Filtering Verification**
1. Trigger a test error with sensitive data in the request:
   ```bash
   curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer fake-token-12345" \
     -d '{"email":"test@example.com","password":"SecretPassword123"}'
   ```
2. Check the error in Sentry dashboard
3. Verify:
   - `password` field shows `[REDACTED]`
   - `Authorization` header is removed
   - Email is not captured in user context
   - No sensitive PII is visible

✅ **Alert Configuration Test**
1. Navigate to **"Alerts"** → **"Alert Rules"**
2. Verify your alert rules are active (green status indicator)
3. Trigger enough errors to meet alert threshold (if testing)
4. Verify you receive alert notification via configured channel (email/Slack)

### Troubleshooting Common Issues

**Issue: "Failed to send event to Sentry" errors**
- **Solution**: Verify DSN is correctly copied (no extra spaces or characters)
- Check that your application can make outbound HTTPS connections to `sentry.io`
- Verify Sentry is initialized before any errors occur (import `instrument.ts` first)

**Issue: No errors appearing in Sentry dashboard**
- **Solution**: Check that Sentry DSN is set in environment variables
- Verify errors are actually being thrown (check application logs)
- Wait 2-3 minutes - there can be a slight delay
- Check Sentry quota limits (free tier has monthly event limits)

**Issue: Too many events being captured**
- **Solution**: Reduce `SENTRY_TRACES_SAMPLE_RATE` to lower percentage (e.g., `0.1`)
- Add error filtering in `instrument.ts` to ignore known/expected errors
- Implement rate limiting on error capture for high-frequency issues

**Issue: Sensitive data appearing in Sentry reports**
- **Solution**: Review and update `beforeSend` hook in `instrument.ts`
- Add additional field names to redaction list
- Test with production-like data to verify filtering works

**Issue: Performance data not appearing**
- **Solution**: Verify `SENTRY_TRACES_SAMPLE_RATE` is > 0
- Check that performance monitoring is enabled in Sentry project settings
- Ensure you're using the latest `@sentry/nestjs` package version

**Issue: Quota exceeded warnings**
- **Solution**: Lower sample rates for development/staging environments
- Implement smarter sampling (e.g., sample 100% of errors, 10% of successes)
- Upgrade to paid tier if production needs exceed free tier limits
- Filter out high-frequency non-critical errors

---

## Infrastructure Summary

After completing all three setups, you should have:

### Supabase PostgreSQL
- ✅ Project created with connection string
- ✅ Connection pooling enabled via PgBouncer
- ✅ SSL connections enforced
- ✅ Database accessible and tested via migrations

### Upstash Redis
- ✅ Regional Redis database created
- ✅ TLS enabled for secure connections
- ✅ No eviction policy configured (for queue reliability)
- ✅ Connection tested and queue operations verified

### Sentry
- ✅ Project created with DSN
- ✅ Performance monitoring enabled
- ✅ Sample rates configured appropriately
- ✅ Error capture tested and verified
- ✅ Sensitive data filtering working

## Next Steps

With all infrastructure services set up and verified, you can proceed to:

1. **Configure Environment Variables**: Add all connection details to your Render deployment (see `002-render-deployment.md`)
2. **Run Database Migrations**: Deploy schema to production database (see `003-database-migrations.md`)
3. **Deploy Services**: Deploy API and worker services to Render
4. **Monitor and Test**: Verify all services are running and communicating correctly

## Security Checklist

Before going to production, verify:

- [ ] All passwords and secrets are stored securely (not in version control)
- [ ] Supabase connection uses SSL (`sslmode=require`)
- [ ] Upstash Redis uses TLS-enabled port
- [ ] Sentry DSN is not exposed in client-side code
- [ ] Database connection limits are appropriate for your traffic
- [ ] Redis eviction policy prevents queue data loss
- [ ] Sentry filters sensitive data from error reports
- [ ] Environment variables are set correctly on Render
- [ ] Backup and recovery procedures are documented

## Cost Optimization

To minimize costs while maintaining reliability:

### Supabase (Free tier: 500MB database, 2GB bandwidth/month)
- Use connection pooling to minimize connection overhead
- Enable auto-pause for non-production projects
- Monitor database size regularly
- Archive old logs and audit data

### Upstash (Free tier: 10,000 commands/day)
- Use regional databases (more cost-effective than global)
- Implement TTL on cached data to reduce memory usage
- Monitor command count in dashboard
- Consider upgrading to pay-as-you-go if free tier is exceeded

### Sentry (Free tier: 5,000 errors/month)
- Adjust sample rates based on traffic (lower for high-traffic apps)
- Filter out expected/non-critical errors
- Use releases to track error trends and fix high-frequency issues quickly
- Monitor quota usage in dashboard

---

**Documentation Version**: 1.0  
**Last Updated**: 2024-01-15  
**Maintained By**: Splitcore Backend Team
