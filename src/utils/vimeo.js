import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import tus from "tus-js-client";
import fs from "fs";
import AppError from "../error/AppError.js";

export const vimeoAPI = axios.create({
  baseURL: "https://api.vimeo.com",
  headers: {
    Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

console.log(
  "🎫 Vimeo Token:",
  process.env.VIMEO_ACCESS_TOKEN ? "Loaded ✅" : "❌ Missing"
);

// Upload video to Vimeo (via external URL)
export const uploadVideo = async (videoUrl, title, description) => {
  const response = await vimeoAPI.post("/me/videos", {
    upload: {
      approach: "pull",
      link: videoUrl,
    },
    name: title,
    description,
  });

  if (!response?.data) throw new AppError("Vimeo upload failed", 502);
  return response.data;
};

// Get video details from Vimeo
export const getVideoDetails = async (videoId) => {
  const response = await vimeoAPI.get(`/videos/${videoId}`);
  if (!response?.data) throw new AppError("Failed to fetch video details", 502);
  return response.data;
};

// Upload local video to Vimeo
export const uploadLocalVideo = async (filePath, title, description) => {
  return new Promise((resolve, reject) => {
    const file = fs.createReadStream(filePath);
    const size = fs.statSync(filePath).size;

    const upload = new tus.Upload(file, {
      endpoint: "https://api.vimeo.com/me/videos",
      metadata: {
        name: title,
        description,
      },
      uploadSize: size,
      headers: {
        Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
      },
      onError: (error) => reject(new AppError(error.message, 502)),
      onSuccess: () => {
        if (!upload.url) reject(new AppError("Vimeo upload failed", 502));
        resolve(upload.url);
      },
    });

    upload.start();
  });
};

// Delete video from Vimeo
export const deleteVideoFromVimeo = async (vimeoId) => {
  const response = await axios.delete(
    `https://api.vimeo.com/videos/${vimeoId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
      },
    }
  );

  if (response.status !== 204)
    throw new AppError("Failed to delete video from Vimeo", 502);

  return true;
};

// Upload thumbnail to Vimeo
export const uploadThumbnailToVimeo = async (videoId, imagePath) => {
  const createRes = await axios.post(
    `https://api.vimeo.com/videos/${videoId}/pictures`,
    {},
    {
      headers: {
        Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
      },
    }
  );

  const uploadLink = createRes.data?.link;
  if (!uploadLink)
    throw new AppError("Failed to get thumbnail upload link", 502);

  const image = fs.readFileSync(imagePath);
  await axios.put(uploadLink, image, {
    headers: {
      "Content-Type": "image/jpeg",
    },
  });

  const pictureId = createRes.data.uri.split("/").pop();
  await axios.patch(
    `https://api.vimeo.com/videos/${videoId}/pictures/${pictureId}`,
    { active: true },
    {
      headers: {
        Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
      },
    }
  );

  return createRes.data;
};
