export const getTrending = async (req, res) => {
  const movies = await Movie.find().sort({ score: -1 }).limit(20);
  res.json(movies);
};
export const updateMovieScore = async (req, res, next) => {
  try {
    const movies = await Movie.find(
      {},
      "stats plays likes createdAt stats.plays stats.likes views likes"
    );

    const bulkOps = movies.map((movie) => {
      const hoursSince =
        (Date.now() - new Date(movie.createdAt).getTime()) / (1000 * 60 * 60);
      const newness = Math.max(0, 1 - hoursSince / (24 * 7));
      const plays = movie.stats?.plays || 0;
      const likes = movie.stats?.likes || 0;
      const score = plays * 0.3 + likes * 0.6 + newness * 10;

      return {
        updateOne: {
          filter: { _id: movie._id },
          update: { $set: { score } },
        },
      };
    });

    if (bulkOps.length) await Movie.bulkWrite(bulkOps);

    res.json({ success: true, updated: bulkOps.length });
  } catch (err) {
    next(err);
  }
};
