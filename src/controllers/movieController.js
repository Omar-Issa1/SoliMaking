import Movie from "../models/Movie.js";

import {
  uploadVideo,
  getVideoDetails,
  deleteVideoFromVimeo,
} from "../utils/vimeo.js";
import mongoose from "mongoose";

export const addMovie = async (req, res) => {
  try {
    const { title, description, vimeoUrl } = req.body;

    if (!title || !vimeoUrl) {
      return res
        .status(400)
        .json({ message: "Title and Vimeo URL are required" });
    }

    const vimeoId = vimeoUrl.split("/").pop();
    const video = await getVideoDetails(vimeoId);

    const movie = await Movie.create({
      // Basic info
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

      // Data groups
      privacy: video.privacy?.view || null,
      status: video.status || null,
      transcodeStatus: video.transcode?.status || null,
      embedHtml: video.embed?.html || null,
      tags: video.tags || [],
      files: video.files || [],
      // Stats
      stats: {
        plays: video.stats?.plays || 0,
        likes: video.metadata?.connections?.likes?.total || 0,
        comments: video.metadata?.connections?.comments?.total || 0,
      },
      // Uploader info
      uploader: {
        name: video.user?.name || null,
        link: video.user?.link || null,
        picture: video.user?.pictures?.sizes?.[1]?.link || null,
        accountType: video.user?.account_type || null,
      },
    });

    res.status(201).json(movie);
  } catch (error) {
    console.error("Add Movie Failed:", error.response?.data || error.message);
    res
      .status(500)
      .json({ message: "Failed to add movie", error: error.message });
  }
};
export const getMovies = async (req, res) => {
  try {
    const movies = await Movie.find()
      .sort({ createdAt: -1 })
      .select("_id title thumbnail duration uploadDate");

    res.json(movies);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch movies" });
  }
};

export const getMovieById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie ID" });
    }

    const movie = await Movie.findById(id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const details = await getVideoDetails(movie.vimeoId);

    res.json({
      ...movie.toObject(),
      vimeo: details,
    });
  } catch (error) {
    console.error("getMovieById error:", error.message);
    res
      .status(500)
      .json({ message: "Failed to fetch movie details", error: error.message });
  }
};
export const updateMovie = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie ID" });
    }

    const updatedMovie = await Movie.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedMovie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    res.json(updatedMovie);
  } catch (error) {
    console.error("updateMovie error:", error.message);
    res
      .status(500)
      .json({ message: "Failed to update movie", error: error.message });
  }
};
export const deleteMovie = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid movie ID" });
    }

    const movie = await Movie.findById(id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    if (movie.vimeoId) {
      await deleteVideoFromVimeo(movie.vimeoId);
    }

    await Movie.findByIdAndDelete(id);

    res.json({ message: "Movie deleted successfully from DB and Vimeo" });
  } catch (error) {
    console.error("deleteMovie error:", error.message);
    res
      .status(500)
      .json({ message: "Failed to delete movie", error: error.message });
  }
};
