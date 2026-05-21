const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const config = require("./config.js");
const movieModel = require("./movie-model.js");
const userModel = require("./user-model.js");

const app = express();

app.use(bodyParser.json());

app.use(session({
  secret: config.sessionSecret,
  resave: true,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    sameSite: 'lax'
  }
}));

app.use(express.static(path.join(__dirname, "files")));

function requireLogin(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.sendStatus(401);
  }
}

app.post("/login", function (req, res) {
  const { username, password } = req.body;
  const user = userModel[username];
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.user = {
      username,
      firstName: user.firstName,
      lastName: user.lastName,
      loginTime: new Date().toISOString(),
    };
    req.session.save(function(err) {
      if (err) {
        return res.sendStatus(500);
      }
      res.send(req.session.user);
    });
  } else {
    res.sendStatus(401);
  }
});

app.get("/logout", function (req, res) {
  req.session.destroy(function (err) {
    if (err) {
      res.sendStatus(500);
    } else {
      res.sendStatus(200);
    }
  });
});

app.get("/session", function (req, res) {
  if (req.session.user) {
    res.send(req.session.user);
  } else {
    res.status(401).json(null);
  }
});

app.get("/movies", requireLogin, function (req, res) {
  const username = req.session.user.username;
  let movies = Object.values(movieModel.getUserMovies(username));
  const queriedGenre = req.query.genre;
  if (queriedGenre) {
    movies = movies.filter((movie) => movie.Genres.indexOf(queriedGenre) >= 0);
  }
  res.send(movies);
});

app.get("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  const movie = movieModel.getUserMovie(username, id);
  if (movie) {
    res.send(movie);
  } else {
    res.sendStatus(404);
  }
});

app.put("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const imdbID = req.params.imdbID;
  const exists = movieModel.getUserMovie(username, imdbID) !== undefined;

  if (!exists) {
    const url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbID)}&apikey=${config.omdbApiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

    fetch(url, { signal: controller.signal })
      .then(apiRes => {
        clearTimeout(timeoutId);
        if (!apiRes.ok) return res.sendStatus(apiRes.status);
        return apiRes.json().then(data => {
          if (data.Response === 'False') return res.sendStatus(404);

          const movie = {
            imdbID: data.imdbID,
            Title: data.Title,
            Released: data.Released ? new Date(data.Released).toISOString().split('T')[0] : null,
            Runtime: parseInt(data.Runtime) || 0,
            Genres: data.Genre ? data.Genre.split(', ') : [],
            Directors: data.Director ? data.Director.split(', ') : [],
            Writers: data.Writer ? data.Writer.split(', ') : [],
            Actors: data.Actors ? data.Actors.split(', ') : [],
            Plot: data.Plot,
            Poster: data.Poster,
            Metascore: parseInt(data.Metascore) || 0,
            imdbRating: parseFloat(data.imdbRating) || 0,
          };

          movieModel.setUserMovie(username, imdbID, movie);
          res.status(201).send(movie);
        });
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') return res.sendStatus(504);
        console.error('OMDb error:', err);
        res.sendStatus(500);
      });
  } else {
    movieModel.setUserMovie(username, imdbID, req.body);
    res.sendStatus(200);
  }
});

app.delete("/movies/:imdbID", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  if (movieModel.deleteUserMovie(username, id)) {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.get("/genres", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const genres = movieModel.getGenres(username);
  genres.sort();
  res.send(genres);
});

app.get("/search", requireLogin, function (req, res) {
  const username = req.session.user.username;
  const query = req.query.query;
  if (!query) return res.sendStatus(400);

  const url = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${config.omdbApiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

  fetch(url, { signal: controller.signal })
    .then(apiRes => {
      clearTimeout(timeoutId);
      if (!apiRes.ok) return res.sendStatus(apiRes.status);
      return apiRes.text().then(data => {
        let response;
        try {
          response = JSON.parse(data);
        } catch (parseError) {
          return res.sendStatus(500);
        }

        if (response.Response === 'True') {
          const results = response.Search
            .filter(movie => !movieModel.hasUserMovie(username, movie.imdbID))
            .map(movie => ({
              Title: movie.Title,
              imdbID: movie.imdbID,
              Year: isNaN(movie.Year) ? null : parseInt(movie.Year)
            }));
          res.send(results);
        } else {
          res.send([]);
        }
      });
    })
    .catch(err => {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') return res.sendStatus(504);
      res.sendStatus(500);
    });
});

app.listen(config.port);
console.log(`Server now listening on http://localhost:${config.port}/`);