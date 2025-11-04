import fs from "fs";
import { Vimeo } from "@vimeo/vimeo";
import dotenv from "dotenv";
import AppError from "../error/AppError.js";

dotenv.config();

const client = new Vimeo(
  process.env.VIMEO_CLIENT_ID,
  process.env.VIMEO_CLIENT_SECRET,
  process.env.VIMEO_ACCESS_TOKEN
);

export const uploadLocalVideo = async (filePath, title, description) => {
  return new Promise((resolve, reject) => {
    client.upload(
      filePath,
      {
        name: title || "Untitled Video",
        description: description || "",
        privacy: { view: "unlisted" },
      },
      async function (uri) {
        try {
          const videoId = uri.split("/").pop();
          const videoUrl = `https://vimeo.com/${videoId}`;

          await fs.promises.unlink(filePath).catch(() => {});

          resolve(videoUrl);
        } catch (err) {
          reject(new AppError("Error while cleaning up temp file", 500));
        }
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
};
