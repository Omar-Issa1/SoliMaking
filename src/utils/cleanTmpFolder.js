import fs from "fs";
import path from "path";
import cron from "node-cron";
import winston from "winston";
import "winston-daily-rotate-file";

const TMP_DIR = path.resolve("tmp");
const MAX_FILE_AGE_MINUTES = 30;

const transport = new winston.transports.DailyRotateFile({
  filename: "logs/tmp-cleanup-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "14d",
});

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      ({ timestamp, level, message }) =>
        `${timestamp} [${level.toUpperCase()}]: ${message}`
    )
  ),
  transports: [transport, new winston.transports.Console()],
});

async function deleteOldFiles() {
  try {
    const files = await fs.promises.readdir(TMP_DIR);
    const now = Date.now();
    let deleteCount = 0;

    const deletionPromises = files.map(async (file) => {
      const filePath = path.join(TMP_DIR, file);
      try {
        const stats = await fs.promises.stat(filePath);
        const ageMinutes = (now - stats.mtimeMs) / 1000 / 60;
        if (ageMinutes > MAX_FILE_AGE_MINUTES) {
          await fs.promises.unlink(filePath);
          deleteCount++;
        }
      } catch (err) {
        logger.error(`Failed to process file ${file}: ${err.message}`);
      }
    });

    await Promise.all(deletionPromises);

    logger.info(
      `Deleted ${deleteCount} file(s) older than ${MAX_FILE_AGE_MINUTES} minutes from tmp/`
    );
  } catch (err) {
    logger.error(`Error reading tmp folder: ${err.message}`);
  }
}

cron.schedule("*/10 * * * *", () => {
  logger.info("Running tmp cleanup task...");
  deleteOldFiles();
});

logger.info("TMP cleaner initialized ✅");
