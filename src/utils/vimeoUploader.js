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

/**
 * Upload a local file to Vimeo via official SDK.
 * Returns: { uri, vimeoId, vimeoUrl }
 */
export const uploadLocalVideo = (filePath, title = "", description = "") => {
  return new Promise((resolve, reject) => {
    client.upload(
      filePath,
      {
        name: title || "Untitled Video",
        description: description || "",
        privacy: { view: "unlisted" }, // change if needed
      },
      (uri) => {
        const vimeoId = uri.split("/").pop();
        const vimeoUrl = `https://vimeo.com/${vimeoId}`;

        fs.promises.unlink(filePath).catch(() => {});

        resolve({ uri, vimeoId, vimeoUrl });
      },
      (bytesUploaded, bytesTotal) => {
        const percent = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
        process.stdout.write(`Uploading to Vimeo... ${percent}%\r`);
      },
      (error) => {
        const message =
          error?.message || String(error) || "Vimeo upload failed";
        reject(new AppError(message, 502));
      }
    );
  });
};
