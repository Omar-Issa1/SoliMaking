import mongoose from "mongoose";

const MovieSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    vimeoId: { type: String, required: true, unique: true, index: true },
    vimeoUrl: { type: String, required: true },
    thumbnail: { type: String },
    backdropUrl: { type: String },
    duration: { type: Number, default: 0 },
    lengthCategory: {
      type: String,
      enum: ["Short", "Medium", "Long"],
      index: true,
    },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    uploadDate: { type: Date },
    privacy: { type: String, default: "anybody" },
    status: { type: String, default: "available" },
    transcodeStatus: { type: String, default: "complete" },
    embedHtml: { type: String, default: "" },
    stats: {
      plays: { type: Number, default: 0 },
      likes: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
    },
    uploader: {
      name: { type: String, default: "" },
      link: { type: String, default: "" },
      picture: { type: String, default: "" },
      accountType: { type: String, default: null },
    },
    score: {
      type: Number,
      default: 0,
      index: true,
    },
    views: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },

    files: { type: Array, default: [] },
    tags: { type: Array, default: [] },

    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        index: true,
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Movie", MovieSchema);
