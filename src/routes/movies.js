import express from "express";
import {
  addMovie,
  getMovies,
  getMovieById,
  updateMovie,
  deleteMovie,
  getVimeoUploadLink,
  updateVimeoThumbnail,
} from "../controllers/movieController.js";

const router = express.Router();
router.post(
  "/:id/thumbnail",
  uploadImage.single("thumbnail"),
  updateVimeoThumbnail
);

router.post("/vimeo/upload", getVimeoUploadLink);
router.post("/", addMovie);
router.get("/", getMovies);
router.get("/:id", getMovieById);
router.patch("/:id", updateMovie);
router.delete("/:id", deleteMovie);

export default router;
