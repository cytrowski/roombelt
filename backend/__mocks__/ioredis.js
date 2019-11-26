function Redis(url) {
  this.url = url;
}

Redis.set = Redis.prototype.set = jest.fn(() => {});

module.exports = Redis;