import express from "express";
const app = express();
import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import cors from "cors";
import morgan from "morgan";
import connectDB from "./config/db.js";
import "./utils/cleanTmpFolder.js";
import movieRoutes from "./routes/movies.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import notFound from "./middlewares/not-found.js";
import authRouter from "./routes/auth.js";
import authenticateUser from "./middlewares/authentication.js";
import categoryRoutes from "./routes/categories.js";

import helmet from "helmet";
import rateLimiter from "express-rate-limit";
app.set("trust proxy", 1);

app.use(
  rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  })
);
const tmpDir = path.resolve("tmp");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
  console.log("Created tmp directory");
}

app.use(express.json());

app.use(cors());
app.use(morgan("dev"));
app.use(helmet());
app.use((req, res, next) => {
  console.log("Origin:", req.headers.origin);
  next();
});

connectDB();

app.use("/api/v1/movies", authenticateUser, movieRoutes);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/categories", authenticateUser, categoryRoutes);
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
