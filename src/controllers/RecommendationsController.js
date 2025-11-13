import Movie from "../models/Movie.js";
import Interaction from "../models/UserInteraction.js";
import { NotFoundError } from "../error/index.js";
export const recommendForUser = async (req, res) => {
  const userId = req.user.id;

  const interactions = await Interaction.find({ userId }).populate("movieId");

  if (interactions.length === 0) {
    const trending = await Movie.find().sort({ score: -1 }).limit(10);
    return res.json(trending);
  }

  const categoryCount = {};
  const lengthCount = {};

  interactions.forEach((i) => {
    const movie = i.movieId;

    movie.categories.forEach((cat) => {
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });

    lengthCount[movie.lengthCategory] =
      (lengthCount[movie.lengthCategory] || 0) + 1;
  });

  const favCategories = Object.keys(categoryCount).sort(
    (a, b) => categoryCount[b] - categoryCount[a]
  );

  const favLengths = Object.keys(lengthCount).sort(
    (a, b) => lengthCount[b] - lengthCount[a]
  );

  const recommendations = await Movie.find({
    categories: { $in: favCategories.slice(0, 2) },
    lengthCategory: { $in: favLengths.slice(0, 1) },
  })
    .sort({ score: -1 })
    .limit(15);

  res.json(recommendations);
};
export const getContentRecommendations = async (req, res) => {
  const movieId = req.params.id;

  const movie = await Movie.findById(movieId);
  if (!movie) throw new NotFoundError("Movie not found");

  const recommendations = await Movie.find({
    _id: { $ne: movieId },
    categories: { $in: movie.categories },
    lengthCategory: movie.lengthCategory,
  })
    .sort({ score: -1 })
    .limit(10);

  res.json(recommendations);
};
