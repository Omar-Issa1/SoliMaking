import Movie from "../models/Movie.js";
import Interaction from "../models/Interaction.js";
import { NotFoundError } from "../error/index.js";

const ACTION_WEIGHTS = {
  view: 1,
  like: 3,
  share: 4,
  complete: 5,
};

const DEFAULT_LIMIT = 20;

function addWeightMap(map, key, weight) {
  if (!key) return;
  if (Array.isArray(key)) {
    key.forEach((k) => {
      map[k] = (map[k] || 0) + weight;
    });
  } else {
    map[key] = (map[key] || 0) + weight;
  }
}

function diversifyResults(sortedCandidates, maxResults = DEFAULT_LIMIT) {
  const groups = new Map();
  sortedCandidates.forEach((m) => {
    const primary = (m.categories && m.categories[0]) || "other";
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary).push(m);
  });

  const result = [];
  const iterators = Array.from(groups.values()).map((arr) =>
    arr[Symbol.iterator]()
  );
  while (result.length < maxResults) {
    let added = false;
    for (let it of iterators) {
      const next = it.next();
      if (!next.done) {
        result.push(next.value);
        added = true;
        if (result.length >= maxResults) break;
      }
    }
    if (!added) break;
  }

  if (result.length < maxResults) {
    const needed = maxResults - result.length;
    const leftover = sortedCandidates
      .filter((m) => !result.includes(m))
      .slice(0, needed);
    result.push(...leftover);
  }

  return result.slice(0, maxResults);
}

export const recommendForUserV2 = async (req, res) => {
  const userId = req.user.id;

  const interactions = await Interaction.find({ userId })
    .sort({ timestamp: -1 })
    .limit(500)
    .populate("movieId")
    .lean();

  if (!interactions || interactions.length === 0) {
    const trending = await Movie.find().sort({ score: -1 }).limit(10).lean();
    return res.json(trending);
  }

  const categoryWeight = {};
  const lengthWeight = {};
  const directorWeight = {};
  const actorWeight = {};
  const keywordWeight = {};

  const seenIds = new Set();

  interactions.forEach((inter) => {
    const w = ACTION_WEIGHTS[inter.action] || 1;
    const movie = inter.movieId;
    if (!movie) return;
    seenIds.add(String(movie._id));

    if (Array.isArray(movie.categories)) {
      movie.categories.forEach((cat) => addWeightMap(categoryWeight, cat, w));
    }

    if (movie.lengthCategory)
      addWeightMap(lengthWeight, movie.lengthCategory, w);

    if (Array.isArray(movie.directors))
      movie.directors.forEach((d) => addWeightMap(directorWeight, d, w));
    if (Array.isArray(movie.actors))
      movie.actors.forEach((a) => addWeightMap(actorWeight, a, w));
    if (Array.isArray(movie.keywords))
      movie.keywords.forEach((k) => addWeightMap(keywordWeight, k, w));
  });

  const favCategories = Object.keys(categoryWeight).sort(
    (a, b) => categoryWeight[b] - categoryWeight[a]
  );
  const favLengths = Object.keys(lengthWeight).sort(
    (a, b) => lengthWeight[b] - lengthWeight[a]
  );

  const anyCategoryKeys = Object.keys(categoryWeight);
  const anyLengthKeys = Object.keys(lengthWeight);
  const anyDirectorKeys = Object.keys(directorWeight);
  const anyActorKeys = Object.keys(actorWeight);
  const anyKeywordKeys = Object.keys(keywordWeight);

  const candidateQuery = {
    _id: { $nin: Array.from(seenIds) },
    $or: [],
  };

  if (anyCategoryKeys.length)
    candidateQuery.$or.push({ categories: { $in: anyCategoryKeys } });
  if (anyLengthKeys.length)
    candidateQuery.$or.push({ lengthCategory: { $in: anyLengthKeys } });
  if (anyDirectorKeys.length)
    candidateQuery.$or.push({ directors: { $in: anyDirectorKeys } });
  if (anyActorKeys.length)
    candidateQuery.$or.push({ actors: { $in: anyActorKeys } });
  if (anyKeywordKeys.length)
    candidateQuery.$or.push({ keywords: { $in: anyKeywordKeys } });

  if (candidateQuery.$or.length === 0) {
    const trending = await Movie.find()
      .sort({ score: -1 })
      .limit(DEFAULT_LIMIT)
      .lean();
    return res.json(trending);
  }

  let candidates = await Movie.find(candidateQuery).limit(500).lean();

  let maxContentScore = 0;
  const candWithScores = candidates.map((m) => {
    let contentScore = 0;

    if (Array.isArray(m.categories)) {
      m.categories.forEach((c) => {
        if (categoryWeight[c]) contentScore += categoryWeight[c];
      });
    }

    if (m.lengthCategory && lengthWeight[m.lengthCategory])
      contentScore += lengthWeight[m.lengthCategory];

    if (Array.isArray(m.directors)) {
      m.directors.forEach((d) => {
        if (directorWeight[d]) contentScore += directorWeight[d];
      });
    }

    if (Array.isArray(m.actors)) {
      m.actors.forEach((a) => {
        if (actorWeight[a]) contentScore += actorWeight[a];
      });
    }

    if (Array.isArray(m.keywords)) {
      m.keywords.forEach((k) => {
        if (keywordWeight[k]) contentScore += keywordWeight[k];
      });
    }

    if (contentScore > maxContentScore) maxContentScore = contentScore;

    return {
      movie: m,
      contentScore,
      baseScore: typeof m.score === "number" ? m.score : 0,
    };
  });

  const baseScoreWeight = 0.6;
  const contentWeight = 0.4;

  candWithScores.forEach((c) => {
    const normalizedContent =
      maxContentScore > 0 ? (c.contentScore / maxContentScore) * 100 : 0;

    const base = c.baseScore;
    c.totalScore = base * baseScoreWeight + normalizedContent * contentWeight;
  });

  candWithScores.sort((a, b) => b.totalScore - a.totalScore);

  const sortedMovies = candWithScores.map((c) => {
    return {
      ...c.movie,
      __reco: {
        totalScore: c.totalScore,
        contentScore: c.contentScore,
        baseScore: c.baseScore,
      },
    };
  });

  const final = diversifyResults(sortedMovies, DEFAULT_LIMIT);

  res.json(final);
};

export const getContentRecommendationsV2 = async (req, res) => {
  const movieId = req.params.id;

  const movie = await Movie.findById(movieId).lean();
  if (!movie) throw new NotFoundError("Movie not found");

  const WEIGHT_CATEGORY = 3;
  const WEIGHT_LENGTH = 2;
  const WEIGHT_DIRECTOR = 4;
  const WEIGHT_ACTOR = 2.5;
  const WEIGHT_KEYWORD = 1.5;

  const seenQuery = { _id: { $ne: movie._id } };

  const candidateQuery = {
    ...seenQuery,
    $or: [],
  };

  if (Array.isArray(movie.categories) && movie.categories.length)
    candidateQuery.$or.push({ categories: { $in: movie.categories } });
  if (movie.lengthCategory)
    candidateQuery.$or.push({ lengthCategory: movie.lengthCategory });
  if (Array.isArray(movie.directors) && movie.directors.length)
    candidateQuery.$or.push({ directors: { $in: movie.directors } });
  if (Array.isArray(movie.actors) && movie.actors.length)
    candidateQuery.$or.push({ actors: { $in: movie.actors } });
  if (Array.isArray(movie.keywords) && movie.keywords.length)
    candidateQuery.$or.push({ keywords: { $in: movie.keywords } });

  if (candidateQuery.$or.length === 0) {
    const trending = await Movie.find({ _id: { $ne: movie._id } })
      .sort({ score: -1 })
      .limit(10)
      .lean();
    return res.json(trending);
  }

  let candidates = await Movie.find(candidateQuery).limit(300).lean();

  let maxContent = 0;
  const scored = candidates.map((m) => {
    let contentScore = 0;
    if (Array.isArray(m.categories)) {
      const commonCats = m.categories.filter((c) =>
        movie.categories.includes(c)
      ).length;
      contentScore += commonCats * WEIGHT_CATEGORY;
    }

    if (m.lengthCategory && m.lengthCategory === movie.lengthCategory)
      contentScore += WEIGHT_LENGTH;

    if (Array.isArray(m.directors) && movie.directors) {
      const commonDir = m.directors.filter((d) =>
        movie.directors.includes(d)
      ).length;
      contentScore += commonDir * WEIGHT_DIRECTOR;
    }

    if (Array.isArray(m.actors) && movie.actors) {
      const commonActors = m.actors.filter((a) =>
        movie.actors.includes(a)
      ).length;
      contentScore += commonActors * WEIGHT_ACTOR;
    }

    if (Array.isArray(m.keywords) && movie.keywords) {
      const commonKw = m.keywords.filter((k) =>
        movie.keywords.includes(k)
      ).length;
      contentScore += commonKw * WEIGHT_KEYWORD;
    }

    if (contentScore > maxContent) maxContent = contentScore;

    return {
      movie: m,
      contentScore,
      baseScore: typeof m.score === "number" ? m.score : 0,
    };
  });

  const baseWeight = 0.6;
  const contentW = 0.4;

  scored.forEach((c) => {
    const norm = maxContent > 0 ? (c.contentScore / maxContent) * 100 : 0;
    c.totalScore = c.baseScore * baseWeight + norm * contentW;
  });

  scored.sort((a, b) => b.totalScore - a.totalScore);

  const results = scored.slice(0, 10).map((c) => ({
    ...c.movie,
    __reco: {
      totalScore: c.totalScore,
      contentScore: c.contentScore,
      baseScore: c.baseScore,
    },
  }));

  res.json(results);
};
