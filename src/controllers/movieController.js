import fs from "fs";
import { Vimeo } from "@vimeo/vimeo";
import {
  AppError,
  BadRequestError,
  NotFoundError,
  UnauthenticatedError,
} from "../error/index.js";
import {
  uploadVideo,
  getVideoDetails,
  deleteVideoFromVimeo,
  uploadThumbnailToVimeo,
  vimeoAPI,
} from "../utils/vimeo.js";
import Movie from "../models/Movie.js";
import { uploadLocalVideo } from "../utils/vimeoUploader.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Interaction from "../models/UserInteraction.js";

dotenv.config();
export const addMovie = async (req, res, next) => {
  const { title, description, vimeoUrl } = req.body;

  if (!title || !vimeoUrl)
    throw new BadRequestError("Title and Vimeo URL are required");

  const vimeoId = vimeoUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
  if (!vimeoId) throw new BadRequestError("Invalid Vimeo URL");

  const existingMovie = await Movie.findOne({ vimeoId });
  if (existingMovie)
    throw new BadRequestError("This video already exists in the database");

  const video = await getVideoDetails(vimeoId);

  const movie = await Movie.create({
    title: video.name || title,
    description: video.description || description,
    vimeoId,
    vimeoUrl: video.link || vimeoUrl,
    thumbnail: video.pictures?.sizes?.at(-1)?.link || null,
    duration: video.duration || null,
    width: video.width || null,
    height: video.height || null,
    uploadDate: video.created_time || null,
    modifiedAt: video.modified_time || null,
    privacy: video.privacy?.view || null,
    status: video.status || null,
    transcodeStatus: video.transcode?.status || null,
    embedHtml: video.embed?.html || null,
    tags: video.tags || [],
    files: video.files || [],
    stats: {
      plays: video.stats?.plays || 0,
      likes: video.metadata?.connections?.likes?.total || 0,
      comments: video.metadata?.connections?.comments?.total || 0,
    },
    uploader: {
      name: video.user?.name || null,
      link: video.user?.link || null,
      picture: video.user?.pictures?.sizes?.[1]?.link || null,
      accountType: video.user?.account_type || null,
    },
  });

  res.status(201).json(movie);
};

export const getMovies = async (req, res, next) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  const movies = await Movie.find()
    .populate("categories", "name slug")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const total = await Movie.countDocuments();

  res.json({
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    movies,
  });
};

export const getMovieById = async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new BadRequestError("Invalid movie ID");

  const movie = await Movie.findById(id).populate("categories", "name slug");

  if (!movie) throw new NotFoundError("Movie not found");

  const details = await getVideoDetails(movie.vimeoId);

  res.json({
    ...movie.toObject(),
    vimeo: details,
  });
};

export const updateMovie = async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new BadRequestError("Invalid movie ID");

  const allowedUpdates = ["title", "description"];
  const filtered = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => allowedUpdates.includes(key))
  );

  const updatedMovie = await Movie.findByIdAndUpdate(id, filtered, {
    new: true,
    runValidators: true,
  });

  if (!updatedMovie) throw new NotFoundError("Movie not found");

  res.json(updatedMovie);
};

export const deleteMovie = async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new BadRequestError("Invalid movie ID");

  const movie = await Movie.findById(id);
  if (!movie) throw new NotFoundError("Movie not found");

  if (movie.vimeoId) await deleteVideoFromVimeo(movie.vimeoId);

  await Movie.findByIdAndDelete(id);

  res.json({
    message: "Movie deleted successfully from DB (and Vimeo if possible)",
  });
};

export const getVimeoUploadLink = async (req, res, next) => {
  const { size, title, description } = req.body;

  if (!size || !title) throw new BadRequestError("Size and title are required");

  const response = await vimeoAPI.post("/me/videos", {
    upload: { approach: "tus", size },
    name: title,
    description,
  });

  res.json({
    uploadLink: response.data.upload.upload_link,
    videoUri: response.data.uri,
  });
};

export const updateVimeoThumbnail = async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id))
    throw new BadRequestError("Invalid movie ID");

  const movie = await Movie.findById(id);
  if (!movie) throw new NotFoundError("Movie not found");
  if (!req.file) throw new BadRequestError("No image uploaded");

  const result = await uploadThumbnailToVimeo(movie.vimeoId, req.file.path);

  movie.thumbnail = result.link;
  await movie.save();

  res.json({
    success: true,
    message: "Thumbnail updated successfully",
    thumbnail: movie.thumbnail,
  });
};
const client = new Vimeo(
  process.env.VIMEO_CLIENT_ID,
  process.env.VIMEO_CLIENT_SECRET,
  process.env.VIMEO_ACCESS_TOKEN
);

// helper: wait until transcode complete (poll)
const waitForTranscode = async (
  vimeoId,
  timeoutMs = 5 * 60 * 1000,
  intervalMs = 5000
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await getVideoDetails(vimeoId);
    const status = info.transcode?.status || info.status;
    // Vimeo may expose transcode.status === "complete" or status === "available"
    if (status === "complete" || status === "available") return info;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new AppError(
    "Timeout waiting for Vimeo to finish processing the video",
    504
  );
};

export const uploadLocalVideoController = async (req, res, next) => {
  if (!req.file) throw new BadRequestError("No video file uploaded");

  const { title, description } = req.body;
  let categories = req.body.categories;

  if (categories) {
    if (typeof categories === "string") {
      try {
        categories = JSON.parse(categories);
      } catch (err) {
        categories = categories
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    if (!Array.isArray(categories)) categories = [categories];
  }

  const filePath = req.file.path;

  const { uri, vimeoId, vimeoUrl } = await uploadLocalVideo(
    filePath,
    title,
    description
  );

  const videoInfo = await waitForTranscode(vimeoId).catch(async (err) => {
    // if transcode times out or fails, attempt to cleanup the video on Vimeo (best effort) then rethrow
    await deleteVideoFromVimeo(vimeoId).catch(() => {});
    throw err;
  });

  const existing = await Movie.findOne({ vimeoId });
  if (existing) {
    // rollback on Vimeo (best-effort)
    await deleteVideoFromVimeo(vimeoId).catch(() => {});
    throw new BadRequestError("This video already exists in the database");
  }

  const pictures = videoInfo.pictures?.sizes || [];
  const largestPicture = pictures.at(-1)?.link || null;
  const secondLargest = pictures.at(-2)?.link || null;
  const duration = videoInfo.duration || 0;
  const lengthCategory =
    duration < 600 ? "Short" : duration < 1800 ? "Medium" : "Long";

  const movie = await Movie.create({
    title: videoInfo.name || title,
    description: videoInfo.description || description,
    vimeoId,
    vimeoUrl: videoInfo.link || vimeoUrl,
    thumbnail: largestPicture,
    backdropUrl: secondLargest,
    duration,
    lengthCategory,
    uploadDate: videoInfo.created_time || null,
    privacy: videoInfo.privacy?.view || null,
    transcodeStatus: videoInfo.transcode?.status || null,
    embedHtml: videoInfo.embed?.html || null,
    tags: videoInfo.tags || [],
    files: videoInfo.files || [],
    stats: {
      plays: videoInfo.stats?.plays || 0,
      likes: videoInfo.metadata?.connections?.likes?.total || 0,
      comments: videoInfo.metadata?.connections?.comments?.total || 0,
    },
    uploader: {
      name: videoInfo.user?.name || null,
      link: videoInfo.user?.link || null,
      picture: videoInfo.user?.pictures?.sizes?.at(-1)?.link || null,
      accountType: videoInfo.user?.account_type || null,
    },
    categories,
  });

  await fs.promises.unlink(filePath).catch(() => {});

  res.status(201).json({
    success: true,
    message: "Video uploaded & saved successfully",
    movie,
  });
};
export const registerView = async (req, res, next) => {
  try {
    const movieId = req.params.id;
    const userId = req.user?.id || null;

    await Interaction.create({ movieId, userId, action: "view" });

    await Movie.findByIdAndUpdate(movieId, { $inc: { "stats.plays": 1 } });

    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
};
