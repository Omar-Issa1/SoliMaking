import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { UnauthenticatedError } from "../error/index.js";

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthenticatedError("Authentication invalid");
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(payload.userId).select("_id name email");
    if (!user) {
      throw new UnauthenticatedError("User no longer exists");
    }

    req.user = { userId: user._id, name: user.name };

    next();
  } catch (error) {
    throw new UnauthenticatedError("Authentication invalid");
  }
};

export default auth;
