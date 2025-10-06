// -------------------- Imports --------------------
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const passportLocalMongoose = require("passport-local-mongoose");
const flash = require("connect-flash");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Multer & Cloudinary
const multer = require("multer");
const { storage } = require("./CloudConfig");
const { cloudinary } = require("./CloudConfig");
const upload = multer({ storage: storage });

const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");
const methodOverride = require("method-override");
const ejsmate = require("ejs-mate");

// Routes Import
const { router: booksRoutes, Book } = require("./routes/books");

// -------------------- App Setup --------------------
const app = express();
const port = 3000;

// -------------------- View Engine --------------------
app.engine("ejs", ejsmate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// -------------------- Core Middleware --------------------
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

// -------------------- MongoDB Connection --------------------
const db_URL = process.env.ATLAS_dbURI ;
mongoose
  .connect(db_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ Mongo Connection Error:", err));

// -------------------- User Schema & Passport Setup --------------------
const userSchema = new Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, enum: ["user", "admin"], default: "user" },
});
userSchema.plugin(passportLocalMongoose);
const User = mongoose.model("User", userSchema);

passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// -------------------- Session, Passport, and Flash --------------------
// app.use(
//   session({
//     secret: "thisshouldbeabettersecret", // move to .env in production
//     resave: false,
//     saveUninitialized: false,
//   })
// );
// app.use(passport.initialize());
// app.use(passport.session());
// app.use(flash());

//update with mongo atlas online database
// -------------------- Mongo Session Store --------------------
const store = MongoStore.create({
  mongoUrl: process.env.ATLAS_dbURI, // MongoDB Atlas connection string
  crypto: {
    secret: "mysecretcode", // you can store this in .env
  },
  touchAfter: 24 * 3600, // Lazy update (update session every 24h)
});

store.on("error", function (e) {
  console.log("❌ Session Store Error:", e);
});

// -------------------- Session, Passport, and Flash --------------------
app.use(
  session({
    store, // use Mongo session store
    secret: "thisshouldbeabettersecret", // also move to .env
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 1 week
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());







// -------------------- Global Locals Middleware --------------------
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

// -------------------- Models --------------------
const orderSchema = new Schema({
  customerName: { type: String, required: true },
  address: { type: String, required: true },
  city: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, required: true },
  books: [
    {
      bookId: { type: Schema.Types.ObjectId, ref: "Book" },
      title: String,
      author: String,
      price: Number,
      quantity: { type: Number, default: 1 },
    },
  ],
  paymentMethod: { type: String, default: "Cash on Delivery" },
  totalAmount: { type: Number, required: true },
  orderDate: { type: Date, default: Date.now },
  status: { type: String, default: "Pending" },
});
const Order = mongoose.model("Order", orderSchema);

// -------------------- Auth Middleware --------------------
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.flash("error", "You must be logged in to perform this action.");
  res.redirect("/login");
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === "admin") return next();
  req.flash("error", "You must be an admin to perform this action.");
  res.redirect("/books");
}

// -------------------- Routes --------------------

// Auth Routes
app.post("/register", async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const adminEmails = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const adminUsernames = (process.env.ADMIN_USERNAMES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const role =
      adminEmails.includes(email) || adminUsernames.includes(username)
        ? "admin"
        : "user";

    const user = new User({ username, email, role });
    const registeredUser = await User.register(user, password);

    req.login(registeredUser, (err) => {
      if (err) return next(err);
      req.flash("success", "User Registered Successfully");
      res.redirect("/books");
    });
  } catch (err) {
    console.log("Registration Error:", err);
    req.flash("error", "Registration Error: " + err.message);
    res.redirect("/register");
  }
});

app.post(
  "/login",
  passport.authenticate("local", {
    failureFlash: true,
    failureRedirect: "/login",
  }),
  (req, res) => {
    req.flash("success", "Welcome Back!");
    res.redirect("/books");
  }
);

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "Logged Out Successfully");
    res.redirect("/books");
  });
});

// -------------------- Main Book Routes --------------------
app.use("/books", booksRoutes); // ✅ Correct position

// -------------------- Book-Related Routes --------------------
app.get("/home", async (req, res) => {
  try {
    const books = await Book.find();
    res.render("home", { books });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error in Home Page");
  }
});

app.get("/books/:id/details", async (req, res) => {
  try {
    const { id } = req.params;
    const book = await Book.findById(id);
    if (!book) {
      req.flash("error", "Book not found");
      return res.redirect("/books");
    }
    res.render("bookDetails", { book });
  } catch (err) {
    console.error(err);
    req.flash("error", "Error fetching book details");
    res.redirect("/books");
  }
});

app.post("/books", upload.single("image"), isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { title, author, description, price, category } = req.body;

    const book = new Book({
      title,
      author,
      description,
      price,
      category,
    });

    if (req.file) {
      book.image = {
        url: req.file.path,
        filename: req.file.filename,
      };
    }

    await book.save();
    req.flash("success", "Book Added Successfully");
    res.redirect("/books");
  } catch (err) {
    console.error("Book Add Error:", err);
    req.flash("error", "Error adding book: " + err.message);
    res.redirect("/new");
  }
});

app.get("/new", isLoggedIn, isAdmin, (req, res) => {
  res.render("new");
});

app.post("/new", upload.single("image"), isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { title, author, description, price, category } = req.body;
    const book = new Book({ title, author, description, price, category });

    if (req.file) {
      book.image = { url: req.file.path, filename: req.file.filename };
    }

    await book.save();
    req.flash("success", "New book added successfully!");
    res.redirect("/books");
  } catch (err) {
    console.error(err);
    req.flash("error", "Failed to add book. Please try again.");
    res.redirect("/new");
  }
});

app.get("/books/:id/edit", isLoggedIn, isAdmin, async (req, res) => {
  const { id } = req.params;
  const book = await Book.findById(id);
  if (!book) {
    req.flash("error", "Book not found");
    return res.redirect("/books");
  }
  res.render("edit", { book });
});

app.put("/books/:id", isLoggedIn, isAdmin, upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, author, description, price, category } = req.body;
    const book = await Book.findById(id);
    if (!book) {
      req.flash("error", "Book not found");
      return res.redirect("/books");
    }

    book.title = title || book.title;
    book.author = author || book.author;
    book.description = description || book.description;
    book.price = price ? Number(price) : book.price;
    if (category) book.category = category;

    if (req.file) {
      if (book.image && book.image.filename) {
        try {
          await cloudinary.uploader.destroy(book.image.filename);
        } catch (err) {
          console.warn("Cloudinary delete warning:", err.message);
        }
      }
      book.image = { url: req.file.path, filename: req.file.filename };
    }

    await book.save();
    req.flash("success", "Book Updated Successfully");
    res.redirect("/books");
  } catch (err) {
    console.error("Book Update Error:", err);
    req.flash("error", "Error updating book: " + err.message);
    res.redirect(`/books/${req.params.id}/edit`);
  }
});

app.delete("/books/:id", isLoggedIn, isAdmin, async (req, res) => {
  const { id } = req.params;
  await Book.findByIdAndDelete(id);
  req.flash("success", "Book Deleted Successfully");
  res.redirect("/books");
});




//..................Sending Message Route ..................
app.post("/contact", async (req, res) => {
  const { name, email, subject, message } = req.body;

  try {
    // 1️⃣ Create transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "yourgmail@gmail.com", // use your sender Gmail
        pass: "your-app-password",   // use App Password (not your real Gmail password)
      },
    });

    // 2️⃣ Mail options
    const mailOptions = {
      from: email,
      to: "junaidwattoo33@gmail.com", // where you’ll receive the message
      subject: `New Contact Form Message: ${subject}`,
      text: `
Name: ${name}
Email: ${email}
Message:
${message}
      `,
    };

    // 3️⃣ Send mail
    await transporter.sendMail(mailOptions);

    req.flash("success", "Your message has been sent successfully!");
    res.redirect("/contact");
  } catch (error) {
    console.error(error);
    req.flash("error", "Something went wrong. Please try again.");
    res.redirect("/contact");
  }
});









// -------------------- Cart & Orders --------------------
app.post("/cart", isLoggedIn, async (req, res) => {
  const { bookId } = req.body;
  const book = await Book.findById(bookId);
  if (!book) return res.redirect("/books");

  if (!req.session.cart) req.session.cart = [];
  req.session.cart.push(book);

  res.redirect("/cart");
});

app.get("/cart", isLoggedIn, (req, res) => {
  const cart = req.session.cart || [];
  res.render("cart", { cart });
});

app.post("/cart/remove", isLoggedIn, (req, res) => {
  const { bookId } = req.body;
  if (!req.session.cart) return res.redirect("/cart");

  req.session.cart = req.session.cart.filter(
    (item) => item._id.toString() !== bookId
  );
  req.flash("success", "Book Removed from Cart Successfully");
  res.redirect("/cart");
});

app.get("/checkout", isLoggedIn, (req, res) => {
  const cart = req.session.cart || [];
  res.render("checkout", { cart });
});

app.post("/complete-order", async (req, res) => {
  try {
    const { name, address, city, postalCode, country, paymentMethod } = req.body;
    const cart = req.session.cart || [];
    if (cart.length === 0) {
      req.flash("error", "Cart is empty. Please add items before checkout.");
      return res.redirect("/cart");
    }

    const totalAmount = cart.reduce(
      (sum, item) => sum + item.price * (item.quantity || 1),
      0
    );

    const newOrder = new Order({
      customerName: name,
      address,
      city,
      postalCode,
      country,
      books: cart.map((item) => ({
        bookId: item._id,
        title: item.title,
        author: item.author,
        price: item.price,
        quantity: item.quantity || 1,
      })),
      paymentMethod:
        paymentMethod === "cod" ? "Cash on Delivery" : "Cash on Delivery",
      totalAmount,
    });

    await newOrder.save();
    req.session.cart = [];
    req.flash("success", "Order placed successfully!");
    res.redirect("/books");
  } catch (err) {
    console.error("Order Error:", err);
    req.flash("error", "Something went wrong while placing your order.");
    res.redirect("/checkout");
  }
});

// -------------------- Static Pages --------------------
app.get("/", (req, res) => res.render("home"));
app.get("/contact", (req, res) => res.render("contact"));
app.get("/about", (req, res) => res.render("about"));
app.get("/login", (req, res) => res.render("user/login"));
app.get("/register", (req, res) => res.render("user/signup"));

// Dashboard
app.get("/dashboard", isLoggedIn, isAdmin, async (req, res) => {
  try {
    const users = await User.find();
    const books = await Book.find();
    const orders = await Order.find().populate("books.bookId");
    res.render("dashboard", { users, books, orders });
  } catch (err) {
    console.error(err);
    req.flash("error", "Unable to load dashboard data.");
    res.redirect("/books");
  }
});

// -------------------- Error Handlers --------------------
app.use((req, res) => {
  res.status(404).render("error", { message: "Page Not Found" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).render("error", {
    message: err.message || "Something went wrong!",
  });
});

// -------------------- Start Server --------------------
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
