import Movie from "../models/Movie.js";
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
} from "../utils/vimeo.js";
import { uploadLocalVideo } from "../utils/vimeoUploader.js";
import mongoose from "mongoose";
import { vimeoAPI } from "../utils/vimeo.js";

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

  const movie = await Movie.findById(id);
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
export const uploadLocalVideoController = async (req, res, next) => {
  if (!req.file) throw new BadRequestError("No video file uploaded");

  const { title, description } = req.body;

  const videoUrl = await uploadLocalVideo(req.file.path, title, description);
  if (!videoUrl) throw new AppError("Video upload failed", 502);

  const vimeoId = videoUrl.match(/vimeo\.com\/(\d+)/)?.[1];
  if (!vimeoId) throw new AppError("Invalid Vimeo video URL returned", 500);

  const existing = await Movie.findOne({ vimeoId });
  if (existing) throw new BadRequestError("This video already exists");

  const video = await getVideoDetails(vimeoId);

  const movie = await Movie.create({
    title: video.name || title,
    description: video.description || description,
    vimeoId,
    vimeoUrl: video.link,
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

  await fs.promises.unlink(req.file.path).catch(() => {});

  res.status(201).json({
    success: true,
    message: "Video uploaded & saved successfully",
    movie,
  });
};
