const config = require("./config");

module.exports = function (req, res, next) {
  if (!config.forceHttps || req.headers["x-forwarded-proto"] === "https") {
    return next();
  } else {
    res.redirect("https://" + req.headers.host + req.url);
  }
};
