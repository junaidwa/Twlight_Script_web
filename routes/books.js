const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// ---------------- Schema ----------------
const bookSchema = new Schema({
  title: String,
  author: String,
  description: String,
  price: Number,
  category: String,
  image: {
    url: String,
    filename: String
  }
});

const Book = mongoose.model("Book", bookSchema);

// ---------------- All Books Route ----------------
router.get("/", async (req, res) => {
  try {
    const books = await Book.find();
    res.render("BooksListing", { books, selectedCategory: "All" });
  } catch (err) {
    console.error("Error loading books:", err);
    res.status(500).send("Error loading books");
  }
});

// ---------------- Category Filter Route ----------------
router.get("/category/:category", async (req, res) => {
  try {
    const category = req.params.category;
    const books = await Book.find({ category });
    res.render("BooksListing", { books, selectedCategory: category });
  } catch (err) {
    console.error("Error loading books by category:", err);
    res.status(500).send("Error loading books by category");
  }
});

module.exports = { router, Book };
