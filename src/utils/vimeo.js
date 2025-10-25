import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import tus from "tus-js-client";
import fs from "fs";
import AppError from "../error/AppError.js";
const vimeoAPI = axios.create({
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

//upload video to vimeo
export const uploadVideo = async (videoUrl, title, description) => {
  try {
    const response = await vimeoAPI.post("/me/videos", {
      upload: {
        approach: "pull",
        link: videoUrl,
      },
      name: title,
      description: description,
    });
    console.log("Uploaded to Vimeo:", response.data);

    return response.data;
  } catch (error) {
    console.error("Vimeo upload error:", error.response?.data || error.message);
    throw new AppError("Vimeo upload failed", 502);
  }
};

//get video details from vimeo
export const getVideoDetails = async (videoId) => {
  try {
    const response = await vimeoAPI.get(`/videos/${videoId}`);
    return response.data;
  } catch (error) {
    console.error("Vimeo API error:", error.response?.data || error.message);
    throw new AppError("Failed to fetch video details", 502);
  }
};

//upload local video file to vimeo
export const uploadLocalVideo = async (filePath, title, description) => {
  return new Promise((resolve, reject) => {
    const file = fs.createReadStream(filePath);
    const size = fs.statSync(filePath).size;

    const upload = new tus.Upload(file, {
      endpoint: "https://api.vimeo.com/me/videos",
      metadata: {
        name: title,
        description: description,
      },
      uploadSize: size,
      headers: {
        Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
      },
      onError: (error) => {
        console.error("Vimeo upload error:", error);
        reject(new AppError("Vimeo upload failed", 502));
      },
      onSuccess: () => {
        console.log("Upload completed:", upload.url);
        resolve(upload.url);
      },
    });

    upload.start();
  });
};
export const deleteVideoFromVimeo = async (vimeoId) => {
  try {
    const response = await axios.delete(
      `https://api.vimeo.com/videos/${vimeoId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
        },
      }
    );
    return response.status === 204;
  } catch (error) {
    console.error("Vimeo delete error:", error.response?.data || error.message);
    throw new AppError("Failed to delete video from Vimeo", 502);
  }
};
