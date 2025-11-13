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

// 🟢 رفع الفيديو محليًا ثم تسجيله تلقائيًا في قاعدة البيانات
export const uploadLocalVideoController = async (req, res, next) => {
  if (!req.file) throw new BadRequestError("No video file uploaded");

  const { title, description } = req.body;
  let { categories } = req.body;

  if (categories) {
    try {
      categories = JSON.parse(categories); // frontend sends JSON array
    } catch (e) {
      throw new BadRequestError("Categories must be a valid JSON array");
    }

    if (!Array.isArray(categories))
      throw new BadRequestError("Categories must be an array");
  }

  const filePath = req.file.path;

  try {
    // 1️⃣ رفع الفيديو إلى Vimeo مباشرة من السيرفر
    const videoUri = await new Promise((resolve, reject) => {
      client.upload(
        filePath,
        {
          name: title || "Untitled Video",
          description: description || "",
          privacy: { view: "unlisted" },
        },
        function (uri) {
          resolve(uri);
        },
        function (bytesUploaded, bytesTotal) {
          const percent = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
          process.stdout.write(`Uploading... ${percent}%\r`);
        },
        function (error) {
          reject(new AppError(error.message, 502));
        }
      );
    });

    const vimeoId = videoUri.split("/").pop();
    const vimeoUrl = `https://vimeo.com/${vimeoId}`;

    // 2️⃣ حذف الملف المؤقت من السيرفر
    await fs.promises.unlink(filePath).catch(() => {});

    // 3️⃣ التحقق من وجود نفس الفيديو مسبقًا
    const existing = await Movie.findOne({ vimeoId });
    if (existing)
      throw new BadRequestError("This video already exists in the database");

    // 4️⃣ جلب بيانات الفيديو من Vimeo
    const video = await getVideoDetails(vimeoId);
    const pictures = video.pictures?.sizes || [];
    const largestPicture = pictures.at(-1)?.link;
    const secondLargest = pictures.at(-2)?.link;

    // 5️⃣ تصنيف طول الفيديو (Short / Medium / Long)
    const duration = video.duration || 0;
    const lengthCategory =
      duration < 600 ? "Short" : duration < 1800 ? "Medium" : "Long";

    // 6️⃣ إنشاء السجل في قاعدة البيانات
    const movie = await Movie.create({
      title: video.name || title,
      description: video.description || description,
      vimeoId,
      vimeoUrl: video.link,
      thumbnail: largestPicture,
      backdropUrl: secondLargest,
      duration,
      lengthCategory,
      uploadDate: video.created_time || null,
      privacy: video.privacy?.view || null,
      transcodeStatus: video.transcode?.status || null,
      embedHtml: video.embed?.html || null,
      tags: video.tags || [],
      stats: {
        plays: video.stats?.plays || 0,
        likes: video.metadata?.connections?.likes?.total || 0,
        comments: video.metadata?.connections?.comments?.total || 0,
      },
      uploader: {
        name: video.user?.name || null,
        link: video.user?.link || null,
        picture: video.user?.pictures?.sizes?.at(-1)?.link || null,
        accountType: video.user?.account_type || null,
      },
      categories,
    });

    // 7️⃣ إرسال الاستجابة النهائية
    res.status(201).json({
      success: true,
      message: "✅ Video uploaded & saved successfully",
      movie,
    });
  } catch (err) {
    console.error("❌ Error in uploadLocalVideoController:", err);
    next(err);
  }
};
