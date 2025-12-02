export const updateMovieScore = async (req, res, next) => {
  try {
    const movies = await Movie.find(
      {},
      "stats plays likes createdAt stats.plays stats.likes stats.plays24h stats.likes24h"
    );

    const bulkOps = [];

    movies.forEach((movie) => {
      const createdAt = new Date(movie.createdAt).getTime();
      const hoursSince = (Date.now() - createdAt) / (1000 * 60 * 60);

      const plays24 = movie.stats?.plays24h || 0;
      const likes24 = movie.stats?.likes24h || 0;

      const growth = plays24 * 0.5 + likes24 * 1.2;

      const totalPlays = movie.stats?.plays || 1;
      const totalLikes = movie.stats?.likes || 0;

      const engagementRate = totalLikes / totalPlays;

      const engagementScore = engagementRate * 20;

      const freshness = Math.exp(-hoursSince / 72); // decay over 3 days

      const score = growth * 0.6 + engagementScore * 0.25 + freshness * 15;

      bulkOps.push({
        updateOne: {
          filter: { _id: movie._id },
          update: { $set: { score } },
        },
      });
    });

    if (bulkOps.length) await Movie.bulkWrite(bulkOps);

    res.json({ success: true, updated: bulkOps.length });
  } catch (err) {
    next(err);
  }
};
