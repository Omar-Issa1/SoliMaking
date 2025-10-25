import express from "express";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import morgan from "morgan";
import connectDB from "./config/db.js";
import movieRoutes from "./routes/movies.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import notFound from "./middlewares/not-found.js";

const app = express();

app.use(express.json());
app.use(cors());
app.use(morgan("dev"));

connectDB();

app.use("/api/v1/movies", movieRoutes);
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
