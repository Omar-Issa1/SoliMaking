import Movie from "../models/Movie.js";
import Interaction from "../models/Interaction.js";
import { NotFoundError, BadRequestError } from "../error/index.js";

const ACTION_WEIGHTS = {
  view: 1,
  like: 3,
  share: 4,
  complete: 5,
};

const CONFIG = {
  MAX_INTERACTIONS: 200,
  MAX_CANDIDATES_USER: 300,
  MAX_CANDIDATES_CONTENT: 200,
  DEFAULT_RESULT_LIMIT: 20,
  CONTENT_WEIGHT: 0.4,
  BASE_SCORE_WEIGHT: 0.6,
  TRENDING_FALLBACK_LIMIT: 10,
  CACHE_TTL: 300,
  TIME_DECAY_DAYS: 30,
  SERENDIPITY_RATIO: 0.15,
  RECENCY_WEIGHT: 0.1,
  MIN_CACHE_HITS: 3,
  MAX_CACHE_SIZE: 2000,
};

const CONTENT_WEIGHTS = {
  CATEGORY: 3,
  LENGTH: 2,
  DIRECTOR: 4,
  ACTOR: 2.5,
  KEYWORD: 1.5,
};

class RecommendationCache {
  constructor() {
    this.cache = new Map();
    this.hitCounts = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (entry) {
      this.hitCounts.set(key, (this.hitCounts.get(key) || 0) + 1);

      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        this.hitCounts.delete(key);
        return null;
      }
      return entry.data;
    }
    return null;
  }

  set(key, data, ttl = CONFIG.CACHE_TTL) {
    // Popular entries get double the TTL
    const hits = this.hitCounts.get(key) || 0;
    const adjustedTTL = hits >= CONFIG.MIN_CACHE_HITS ? ttl * 2 : ttl;

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + adjustedTTL * 1000,
      createdAt: Date.now(),
    });

    if (this.cache.size > CONFIG.MAX_CACHE_SIZE) {
      this.cleanup();
    }
  }

  cleanup() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());

    entries.forEach(([key, value]) => {
      if (now > value.expiresAt) {
        this.cache.delete(key);
        this.hitCounts.delete(key);
      }
    });

    // Remove oldest 20% if still too large
    if (this.cache.size > CONFIG.MAX_CACHE_SIZE) {
      const sortedByAge = entries
        .sort((a, b) => a[1].createdAt - b[1].createdAt)
        .slice(0, Math.floor(CONFIG.MAX_CACHE_SIZE * 0.2));

      sortedByAge.forEach(([key]) => {
        this.cache.delete(key);
        this.hitCounts.delete(key);
      });
    }
  }

  invalidate(pattern) {
    const keys = Array.from(this.cache.keys());
    keys.forEach((key) => {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        this.hitCounts.delete(key);
      }
    });
  }

  clear() {
    this.cache.clear();
    this.hitCounts.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      hitCounts: Object.fromEntries(this.hitCounts),
    };
  }
}

const recommendationCache = new RecommendationCache();

function getCacheKey(userId, type = "user", activityLevel = "normal") {
  const timeWindow = activityLevel === "high" ? 60 : CONFIG.CACHE_TTL;
  return `${type}_${userId}_${Math.floor(Date.now() / (timeWindow * 1000))}`;
}

function calculateTimeDecay(timestamp) {
  const daysSince =
    (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysSince / CONFIG.TIME_DECAY_DAYS);
}

function calculateRecencyBonus(releaseDate) {
  if (!releaseDate) return 0;

  const monthsSinceRelease =
    (Date.now() - new Date(releaseDate).getTime()) / (1000 * 60 * 60 * 24 * 30);

  if (monthsSinceRelease < 6) {
    return (6 - monthsSinceRelease) * 2;
  }
  return 0;
}

function addWeightToMap(map, key, weight) {
  if (!key) return;

  if (Array.isArray(key)) {
    key.forEach((k) => {
      if (k) {
        map[k] = (map[k] || 0) + weight;
      }
    });
  } else {
    map[key] = (map[key] || 0) + weight;
  }
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function diversifyResults(
  sortedCandidates,
  maxResults = CONFIG.DEFAULT_RESULT_LIMIT,
) {
  if (!sortedCandidates || sortedCandidates.length === 0) {
    return [];
  }

  const categoryGroups = new Map();
  const movieToCategories = new Map();

  sortedCandidates.forEach((movie) => {
    const categories =
      movie.categories && Array.isArray(movie.categories)
        ? movie.categories
        : ["other"];

    movieToCategories.set(String(movie._id), categories);

    categories.forEach((category) => {
      if (!categoryGroups.has(category)) {
        categoryGroups.set(category, []);
      }
      categoryGroups.get(category).push(movie);
    });
  });

  categoryGroups.forEach((movies, category) => {
    categoryGroups.set(category, shuffleArray(movies));
  });

  const result = [];
  const seenIds = new Set();
  const categoryIterators = Array.from(categoryGroups.entries()).map(
    ([category, movies]) => ({
      category,
      movies,
      index: 0,
    }),
  );

  const shuffledIterators = shuffleArray(categoryIterators);

  // Round-robin through categories for variety
  let iteratorIndex = 0;
  while (
    result.length < maxResults &&
    shuffledIterators.some((it) => it.index < it.movies.length)
  ) {
    const iterator =
      shuffledIterators[iteratorIndex % shuffledIterators.length];

    if (iterator.index < iterator.movies.length) {
      const movie = iterator.movies[iterator.index];
      const movieId = String(movie._id);

      if (!seenIds.has(movieId)) {
        result.push(movie);
        seenIds.add(movieId);
      }

      iterator.index++;
    }

    iteratorIndex++;
  }

  if (result.length < maxResults) {
    const remaining = sortedCandidates
      .filter((m) => !seenIds.has(String(m._id)))
      .slice(0, maxResults - result.length);
    result.push(...remaining);
  }

  return result.slice(0, maxResults);
}

// Inject highly-rated movies from unfamiliar genres
async function addSerendipity(recommendations, userId, seenIds, targetCount) {
  const surpriseCount = Math.ceil(targetCount * CONFIG.SERENDIPITY_RATIO);

  if (surpriseCount === 0) return recommendations;

  try {
    const userCategories = new Set();
    recommendations.forEach((movie) => {
      if (Array.isArray(movie.categories)) {
        movie.categories.forEach((cat) => userCategories.add(cat));
      }
    });

    const surpriseMovies = await Movie.find({
      _id: {
        $nin: [...Array.from(seenIds), ...recommendations.map((r) => r._id)],
      },
      categories: { $nin: Array.from(userCategories) },
      score: { $gte: 7.5 },
    })
      .limit(surpriseCount * 2)
      .lean();

    if (surpriseMovies.length > 0) {
      const shuffledSurprises = shuffleArray(surpriseMovies).slice(
        0,
        surpriseCount,
      );

      const markedSurprises = shuffledSurprises.map((movie) => ({
        ...movie,
        __reco: {
          ...(movie.__reco || {}),
          isSerendipity: true,
        },
      }));

      const result = [...recommendations];
      markedSurprises.forEach((surprise) => {
        const randomPos = Math.floor(Math.random() * (result.length + 1));
        result.splice(randomPos, 0, surprise);
      });

      return result.slice(0, targetCount);
    }
  } catch (error) {
    console.error("Error adding serendipity:", error);
  }

  return recommendations;
}

function calculateContentScore(movie, weightMaps, includeRecency = false) {
  const {
    categoryWeight,
    lengthWeight,
    directorWeight,
    actorWeight,
    keywordWeight,
  } = weightMaps;
  let score = 0;

  if (Array.isArray(movie.categories)) {
    movie.categories.forEach((cat) => {
      if (categoryWeight[cat]) {
        score += categoryWeight[cat];
      }
    });
  }

  if (movie.lengthCategory && lengthWeight[movie.lengthCategory]) {
    score += lengthWeight[movie.lengthCategory];
  }

  if (Array.isArray(movie.directors)) {
    movie.directors.forEach((director) => {
      if (directorWeight[director]) {
        score += directorWeight[director];
      }
    });
  }

  if (Array.isArray(movie.actors)) {
    movie.actors.forEach((actor) => {
      if (actorWeight[actor]) {
        score += actorWeight[actor];
      }
    });
  }

  if (Array.isArray(movie.keywords)) {
    movie.keywords.forEach((keyword) => {
      if (keywordWeight[keyword]) {
        score += keywordWeight[keyword];
      }
    });
  }

  if (includeRecency && movie.releaseDate) {
    score += calculateRecencyBonus(movie.releaseDate);
  }

  return score;
}

function calculateSimilarityScore(
  candidateMovie,
  referenceMovie,
  includeRecency = false,
) {
  let score = 0;

  if (
    Array.isArray(candidateMovie.categories) &&
    Array.isArray(referenceMovie.categories)
  ) {
    const commonCategories = candidateMovie.categories.filter((c) =>
      referenceMovie.categories.includes(c),
    ).length;
    score += commonCategories * CONTENT_WEIGHTS.CATEGORY;
  }

  if (
    candidateMovie.lengthCategory &&
    candidateMovie.lengthCategory === referenceMovie.lengthCategory
  ) {
    score += CONTENT_WEIGHTS.LENGTH;
  }

  if (
    Array.isArray(candidateMovie.directors) &&
    Array.isArray(referenceMovie.directors)
  ) {
    const commonDirectors = candidateMovie.directors.filter((d) =>
      referenceMovie.directors.includes(d),
    ).length;
    score += commonDirectors * CONTENT_WEIGHTS.DIRECTOR;
  }

  if (
    Array.isArray(candidateMovie.actors) &&
    Array.isArray(referenceMovie.actors)
  ) {
    const commonActors = candidateMovie.actors.filter((a) =>
      referenceMovie.actors.includes(a),
    ).length;
    score += commonActors * CONTENT_WEIGHTS.ACTOR;
  }

  if (
    Array.isArray(candidateMovie.keywords) &&
    Array.isArray(referenceMovie.keywords)
  ) {
    const commonKeywords = candidateMovie.keywords.filter((k) =>
      referenceMovie.keywords.includes(k),
    ).length;
    score += commonKeywords * CONTENT_WEIGHTS.KEYWORD;
  }

  if (includeRecency && candidateMovie.releaseDate) {
    score +=
      calculateRecencyBonus(candidateMovie.releaseDate) * CONFIG.RECENCY_WEIGHT;
  }

  return score;
}

async function getTrendingMovies(
  excludeIds = [],
  limit = CONFIG.TRENDING_FALLBACK_LIMIT,
  diversify = true,
) {
  try {
    const query = excludeIds.length > 0 ? { _id: { $nin: excludeIds } } : {};

    const movies = await Movie.find(query)
      .sort({ score: -1 })
      .limit(diversify ? limit * 2 : limit)
      .lean();

    if (diversify && movies.length > limit) {
      return diversifyResults(movies, limit);
    }

    return movies.slice(0, limit);
  } catch (error) {
    console.error("Error fetching trending movies:", error);
    return [];
  }
}

function buildUserPreferences(interactions) {
  const categoryWeight = {};
  const lengthWeight = {};
  const directorWeight = {};
  const actorWeight = {};
  const keywordWeight = {};
  const seenIds = new Set();

  interactions.forEach((interaction) => {
    const baseWeight = ACTION_WEIGHTS[interaction.action] || 1;
    const timeDecay = calculateTimeDecay(interaction.timestamp);
    const weight = baseWeight * timeDecay;

    const movie = interaction.movieId;
    if (!movie || !movie._id) return;

    seenIds.add(String(movie._id));

    if (Array.isArray(movie.categories)) {
      addWeightToMap(categoryWeight, movie.categories, weight);
    }

    if (movie.lengthCategory) {
      addWeightToMap(lengthWeight, movie.lengthCategory, weight);
    }

    if (Array.isArray(movie.directors)) {
      addWeightToMap(directorWeight, movie.directors, weight);
    }

    if (Array.isArray(movie.actors)) {
      addWeightToMap(actorWeight, movie.actors, weight);
    }

    if (Array.isArray(movie.keywords)) {
      addWeightToMap(keywordWeight, movie.keywords, weight);
    }
  });

  return {
    categoryWeight,
    lengthWeight,
    directorWeight,
    actorWeight,
    keywordWeight,
    seenIds,
  };
}

function buildCandidateQuery(preferences, seenIds) {
  const {
    categoryWeight,
    lengthWeight,
    directorWeight,
    actorWeight,
    keywordWeight,
  } = preferences;

  const candidateQuery = {
    _id: { $nin: Array.from(seenIds) },
    $or: [],
  };

  const categoryKeys = Object.keys(categoryWeight);
  const lengthKeys = Object.keys(lengthWeight);
  const directorKeys = Object.keys(directorWeight);
  const actorKeys = Object.keys(actorWeight);
  const keywordKeys = Object.keys(keywordWeight);

  if (categoryKeys.length > 0) {
    candidateQuery.$or.push({ categories: { $in: categoryKeys } });
  }

  if (lengthKeys.length > 0) {
    candidateQuery.$or.push({ lengthCategory: { $in: lengthKeys } });
  }

  if (directorKeys.length > 0) {
    candidateQuery.$or.push({ directors: { $in: directorKeys } });
  }

  if (actorKeys.length > 0) {
    candidateQuery.$or.push({ actors: { $in: actorKeys } });
  }

  if (keywordKeys.length > 0) {
    candidateQuery.$or.push({ keywords: { $in: keywordKeys } });
  }

  return candidateQuery;
}

function scoreAndRankCandidates(candidates, weightMaps, includeRecency = true) {
  let maxContentScore = 0;

  const candidatesWithScores = candidates.map((movie) => {
    const contentScore = calculateContentScore(
      movie,
      weightMaps,
      includeRecency,
    );
    if (contentScore > maxContentScore) {
      maxContentScore = contentScore;
    }

    return {
      movie,
      contentScore,
      baseScore: typeof movie.score === "number" ? movie.score : 0,
      recencyBonus: includeRecency
        ? calculateRecencyBonus(movie.releaseDate)
        : 0,
    };
  });

  candidatesWithScores.forEach((candidate) => {
    const normalizedContent =
      maxContentScore > 0
        ? (candidate.contentScore / maxContentScore) * 100
        : 0;

    candidate.totalScore =
      candidate.baseScore * CONFIG.BASE_SCORE_WEIGHT +
      normalizedContent * CONFIG.CONTENT_WEIGHT +
      candidate.recencyBonus * CONFIG.RECENCY_WEIGHT;
  });

  candidatesWithScores.sort((a, b) => b.totalScore - a.totalScore);

  return candidatesWithScores.map((candidate) => ({
    ...candidate.movie,
    __reco: {
      totalScore: candidate.totalScore,
      contentScore: candidate.contentScore,
      baseScore: candidate.baseScore,
      recencyBonus: candidate.recencyBonus,
    },
  }));
}

function getUserActivityLevel(interactionCount) {
  if (interactionCount > 100) return "high";
  if (interactionCount > 30) return "normal";
  return "low";
}

export const recommendForUserV2 = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      throw new BadRequestError("User ID is required");
    }

    const userId = req.user.id;

    const interactions = await Interaction.find({ userId })
      .sort({ timestamp: -1 })
      .limit(CONFIG.MAX_INTERACTIONS)
      .populate("movieId")
      .lean();

    const activityLevel = getUserActivityLevel(interactions.length);

    const cacheKey = getCacheKey(userId, "user", activityLevel);
    const cached = recommendationCache.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    // Cold start: no interaction history
    if (!interactions || interactions.length === 0) {
      const trending = await getTrendingMovies(
        [],
        CONFIG.DEFAULT_RESULT_LIMIT,
        true,
      );
      recommendationCache.set(cacheKey, trending);
      return res.json(trending);
    }

    const preferences = buildUserPreferences(interactions);

    const candidateQuery = buildCandidateQuery(
      preferences,
      preferences.seenIds,
    );

    if (candidateQuery.$or.length === 0) {
      const trending = await getTrendingMovies(
        Array.from(preferences.seenIds),
        CONFIG.DEFAULT_RESULT_LIMIT,
        true,
      );
      recommendationCache.set(cacheKey, trending);
      return res.json(trending);
    }

    const candidates = await Movie.find(candidateQuery)
      .limit(CONFIG.MAX_CANDIDATES_USER)
      .lean();

    if (!candidates || candidates.length === 0) {
      const trending = await getTrendingMovies(
        Array.from(preferences.seenIds),
        CONFIG.DEFAULT_RESULT_LIMIT,
        true,
      );
      recommendationCache.set(cacheKey, trending);
      return res.json(trending);
    }

    const rankedMovies = scoreAndRankCandidates(candidates, preferences, true);

    let diversifiedResults = diversifyResults(
      rankedMovies,
      CONFIG.DEFAULT_RESULT_LIMIT,
    );

    const finalRecommendations = await addSerendipity(
      diversifiedResults,
      userId,
      preferences.seenIds,
      CONFIG.DEFAULT_RESULT_LIMIT,
    );

    const cacheTTL = activityLevel === "high" ? 60 : CONFIG.CACHE_TTL;
    recommendationCache.set(cacheKey, finalRecommendations, cacheTTL);

    res.json(finalRecommendations);
  } catch (error) {
    console.error("Error in recommendForUserV2:", error);

    try {
      const fallbackMovies = await getTrendingMovies(
        [],
        CONFIG.DEFAULT_RESULT_LIMIT,
        true,
      );
      return res.json(fallbackMovies);
    } catch (fallbackError) {
      console.error("Error in fallback recommendations:", fallbackError);
      throw new BadRequestError("Unable to generate recommendations");
    }
  }
};

export const getContentRecommendationsV2 = async (req, res) => {
  try {
    if (!req.params || !req.params.id) {
      throw new BadRequestError("Movie ID is required");
    }

    const movieId = req.params.id;

    const cacheKey = getCacheKey(movieId, "content");
    const cached = recommendationCache.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const movie = await Movie.findById(movieId).lean();

    if (!movie) {
      throw new NotFoundError("Movie not found");
    }

    const candidateQuery = {
      _id: { $ne: movie._id },
      $or: [],
    };

    if (Array.isArray(movie.categories) && movie.categories.length > 0) {
      candidateQuery.$or.push({ categories: { $in: movie.categories } });
    }

    if (movie.lengthCategory) {
      candidateQuery.$or.push({ lengthCategory: movie.lengthCategory });
    }

    if (Array.isArray(movie.directors) && movie.directors.length > 0) {
      candidateQuery.$or.push({ directors: { $in: movie.directors } });
    }

    if (Array.isArray(movie.actors) && movie.actors.length > 0) {
      candidateQuery.$or.push({ actors: { $in: movie.actors } });
    }

    if (Array.isArray(movie.keywords) && movie.keywords.length > 0) {
      candidateQuery.$or.push({ keywords: { $in: movie.keywords } });
    }

    if (candidateQuery.$or.length === 0) {
      const trending = await getTrendingMovies(
        [movie._id],
        CONFIG.TRENDING_FALLBACK_LIMIT,
        true,
      );
      recommendationCache.set(cacheKey, trending);
      return res.json(trending);
    }

    const candidates = await Movie.find(candidateQuery)
      .limit(CONFIG.MAX_CANDIDATES_CONTENT)
      .lean();

    if (!candidates || candidates.length === 0) {
      const trending = await getTrendingMovies(
        [movie._id],
        CONFIG.TRENDING_FALLBACK_LIMIT,
        true,
      );
      recommendationCache.set(cacheKey, trending);
      return res.json(trending);
    }

    let maxContentScore = 0;
    const scoredCandidates = candidates.map((candidate) => {
      const contentScore = calculateSimilarityScore(candidate, movie, true);
      if (contentScore > maxContentScore) {
        maxContentScore = contentScore;
      }

      return {
        movie: candidate,
        contentScore,
        baseScore: typeof candidate.score === "number" ? candidate.score : 0,
        recencyBonus: calculateRecencyBonus(candidate.releaseDate),
      };
    });

    scoredCandidates.forEach((candidate) => {
      const normalizedContent =
        maxContentScore > 0
          ? (candidate.contentScore / maxContentScore) * 100
          : 0;

      candidate.totalScore =
        candidate.baseScore * CONFIG.BASE_SCORE_WEIGHT +
        normalizedContent * CONFIG.CONTENT_WEIGHT +
        candidate.recencyBonus * CONFIG.RECENCY_WEIGHT;
    });

    scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);

    const topResults = scoredCandidates
      .slice(0, CONFIG.TRENDING_FALLBACK_LIMIT * 2)
      .map((candidate) => ({
        ...candidate.movie,
        __reco: {
          totalScore: candidate.totalScore,
          contentScore: candidate.contentScore,
          baseScore: candidate.baseScore,
          recencyBonus: candidate.recencyBonus,
        },
      }));

    const recommendations = diversifyResults(
      topResults,
      CONFIG.TRENDING_FALLBACK_LIMIT,
    );

    recommendationCache.set(cacheKey, recommendations);

    res.json(recommendations);
  } catch (error) {
    console.error("Error in getContentRecommendationsV2:", error);

    try {
      const fallbackMovies = await getTrendingMovies(
        [],
        CONFIG.TRENDING_FALLBACK_LIMIT,
        true,
      );
      return res.json(fallbackMovies);
    } catch (fallbackError) {
      console.error(
        "Error in fallback content recommendations:",
        fallbackError,
      );

      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new BadRequestError("Unable to generate content recommendations");
    }
  }
};

export const clearRecommendationCache = async (req, res) => {
  try {
    const { pattern } = req.query;

    if (pattern) {
      recommendationCache.invalidate(pattern);
      return res.json({ message: `Cache cleared for pattern: ${pattern}` });
    }

    recommendationCache.clear();
    res.json({ message: "Recommendation cache cleared successfully" });
  } catch (error) {
    console.error("Error clearing cache:", error);
    throw new BadRequestError("Failed to clear cache");
  }
};

export const getCacheStats = async (req, res) => {
  try {
    const stats = recommendationCache.getStats();
    res.json(stats);
  } catch (error) {
    console.error("Error getting cache stats:", error);
    throw new BadRequestError("Failed to get cache statistics");
  }
};
