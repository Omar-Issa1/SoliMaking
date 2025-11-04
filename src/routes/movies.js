import express from "express";
import multer from "multer";
import {
  addMovie,
  getMovies,
  getMovieById,
  updateMovie,
  deleteMovie,
  getVimeoUploadLink,
  updateVimeoThumbnail,
  uploadLocalVideoController,
} from "../controllers/movieController.js";
import uploadImage from "../middlewares/imageUpload.js";

const router = express.Router();

const upload = multer({
  dest: "tmp/",
  limits: { fileSize: 1024 * 1024 * 500 },
  fileFilter: (req, file, cb) => {
    const allowed = ["video/mp4", "video/mkv", "video/avi", "video/mov"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only video files are allowed!"), false);
  },
});

router.post(
  "/:id/thumbnail",
  uploadImage.single("thumbnail"),
  updateVimeoThumbnail
);
router.post("/vimeo/upload", getVimeoUploadLink);
router.post(
  "/vimeo/local-upload",
  upload.single("video"),
  uploadLocalVideoController
);
router.post("/", addMovie);
router.get("/", getMovies);
router.get("/:id", getMovieById);
router.patch("/:id", updateMovie);
router.delete("/:id", deleteMovie);

export default router;
