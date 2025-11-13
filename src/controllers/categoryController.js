import Category from "../models/Category.js";
import { BadRequestError, NotFoundError } from "../error/index.js";

export const createCategory = async (req, res, next) => {
  const { name, description } = req.body;

  if (!name) throw new BadRequestError("Name is required");

  const slug = name.toLowerCase().replace(/ /g, "-");

  const exists = await Category.findOne({ slug });
  if (exists) throw new BadRequestError("Category already exists");

  const category = await Category.create({ name, slug, description });

  res.status(201).json(category);
};

export const getCategories = async (req, res) => {
  const categories = await Category.find().sort({ name: 1 });
  res.json(categories);
};

export const getCategoryById = async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new NotFoundError("Category not found");
  res.json(category);
};

export const updateCategory = async (req, res) => {
  const { name, description } = req.body;

  const updates = {};
  if (name) updates.name = name;
  if (description !== undefined) updates.description = description;

  if (name) updates.slug = name.toLowerCase().replace(/ /g, "-");

  const category = await Category.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  });

  if (!category) throw new NotFoundError("Category not found");

  res.json(category);
};

export const deleteCategory = async (req, res) => {
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) throw new NotFoundError("Category not found");

  res.json({ message: "Category deleted" });
};
