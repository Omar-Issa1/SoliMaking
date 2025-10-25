// middlewares/errorHandler.js
export const errorHandler = (err, req, res, next) => {
  console.error("Error caught by errorHandler:", err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Something went wrong";

  res.status(statusCode).json({
    success: false,
    error: err.name || "ServerError",
    message,
  });
};
