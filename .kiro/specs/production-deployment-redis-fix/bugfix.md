# Bugfix Requirements Document

## Introduction

The Splitcore backend application fails to deploy on Render.com when Redis is unavailable or rate-limited. The root cause is that `RedisService.connect()` throws an error during NestJS module initialization (`onModuleInit`), which prevents the application from completing bootstrap and binding to the required port. This results in deployment timeouts and service unavailability.

This bug is critical because it prevents the entire application from starting, even though Redis is not required for core functionality. The fix will implement graceful degradation, allowing the application to start and serve traffic with degraded Redis-dependent features when Redis is unavailable.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN Redis connection fails during `onModuleInit` (e.g., rate limit exceeded, connection timeout, or service unavailable) THEN the system throws an error that propagates up the NestJS module initialization chain

1.2 WHEN the Redis connection error propagates during bootstrap THEN the system crashes before calling `app.listen(port)` in main.ts

1.3 WHEN the application crashes during bootstrap THEN the system never binds to the required port, causing Render to detect "No open ports" and timing out after 10 minutes

1.4 WHEN Redis PING fails in `RedisService.connect()` THEN the system throws an error that halts the entire application startup

1.5 WHEN Redis rate limit is exceeded (Upstash free tier: 500k requests/month) THEN the system receives "ERR max requests limit exceeded" during connection attempts

### Expected Behavior (Correct)

2.1 WHEN Redis connection fails during `onModuleInit` (e.g., rate limit exceeded, connection timeout, or service unavailable) THEN the system SHALL log a warning and continue with application startup

2.2 WHEN the Redis connection is unavailable THEN the system SHALL complete bootstrap and successfully call `app.listen(port)` in main.ts

2.3 WHEN the application starts with Redis unavailable THEN the system SHALL bind to the required port within Render's timeout period and serve HTTP traffic

2.4 WHEN Redis PING fails in `RedisService.connect()` THEN the system SHALL mark Redis as unavailable but SHALL NOT throw an error that halts application startup

2.5 WHEN Redis rate limit is exceeded THEN the system SHALL log the rate limit error and operate in degraded mode without crashing

2.6 WHEN Redis is unavailable THEN the system SHALL set an internal flag (e.g., `isConnected = false`) that can be checked by consumers

2.7 WHEN Redis-dependent features are accessed while Redis is unavailable THEN the system SHALL handle the unavailability gracefully (e.g., skip caching, return appropriate errors, or use fallback behavior)

2.8 WHEN the health check endpoint is called while Redis is unavailable THEN the system SHALL report Redis status as "down" but SHALL still return a successful response for the overall health check

### Unchanged Behavior (Regression Prevention)

3.1 WHEN Redis connection succeeds during `onModuleInit` THEN the system SHALL CONTINUE TO establish the connection and set `isConnected = true`

3.2 WHEN Redis is available and working THEN the system SHALL CONTINUE TO use Redis for caching, rate limiting, and other Redis-dependent features

3.3 WHEN the health check endpoint is called with both database and Redis available THEN the system SHALL CONTINUE TO report all systems as "up"

3.4 WHEN Redis connection is successful THEN the system SHALL CONTINUE TO log connection events (connect, ready, error, close)

3.5 WHEN `RedisService.getClient()` is called after successful connection THEN the system SHALL CONTINUE TO return the connected Redis client instance

3.6 WHEN `RedisService.ping()` is called with an active connection THEN the system SHALL CONTINUE TO return true on successful PING

3.7 WHEN `RedisService.onModuleDestroy()` is called with an active connection THEN the system SHALL CONTINUE TO gracefully close the Redis connection

3.8 WHEN the retry strategy exhausts max reconnection attempts under normal circumstances THEN the system SHALL CONTINUE TO log errors appropriately (but SHALL NOT exit the process during initial startup)
