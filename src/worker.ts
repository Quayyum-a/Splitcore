// Temporary worker placeholder until Task 10 implements the full worker
console.log('[Worker] Starting - no processors registered yet');
console.log('[Worker] This is a placeholder until queue workers are implemented');

// Keep process alive
process.stdin.resume();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT, shutting down gracefully');
  process.exit(0);
});
