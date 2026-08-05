import app from "./app";
import { logger } from "./lib/logger";
import { connectRedis } from "./lib/redis.js";
import { config } from "./config.js";

await connectRedis();

app.listen(config.port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port: config.port }, "Server listening");
});
