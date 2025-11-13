import express from "express";
const router = express.Router();
import { registerView } from "../controllers/movieController.js";
import {
  recommendForUser,
  getContentRecommendations,
} from "../controllers/RecommendationsController.js";
import { getTrending, updateMovieScore } from "../controllers/trending.js";
// routes

router.post("/:id/view", registerView);
router.get("/:id/recommendations", getContentRecommendations);
router.get("/trending", getTrending);
router.get("/recommend/me", recommendForUser);
router.patch("/:id/score", updateMovieScore);
export default router;
