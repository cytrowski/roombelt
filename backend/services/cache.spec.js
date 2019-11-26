describe("in memory cache", () => {
  jest.resetModules();

  const cache = require("./cache");

  test("given has elements when set when get then element returned", async () => {
    cache("ns").set("test", "value");

    const result = await cache("ns").get("test");

    expect(result).toBe("value");
  });

  test("given has elements and timeout set when get within timeout then element returned", async () => {
    cache("ns").set("test", "value", new Date(new Date().getTime() + 1e6));

    const result = await cache("ns").get("test");

    expect(result).toBe("value");
  });

  test("given has elements and timeout set when get after timeout then element not returned", async () => {
    cache("ns").set("test", "value", -5);

    const result = await cache("ns").get("test");

    expect(result).toBeNull();
  });

  test("given has element when element deleted then does not exist", async () => {
    cache("ns").set("test", "value");

    await cache("ns").delete("test");

    const result = await cache("ns").get("test");
    expect(result).toBeNull();
  });
});

describe("redis cache", () => {
  jest.resetModules();
  jest.mock("../config");
  const config = require("../config");

  config.redisUrl = "some-redis-url:1234";

  jest.mock("ioredis");
  const Redis = require("ioredis");

  const cache = require("./cache");

  test("given not ttl when set then appropriate functions called", async () => {
    await cache("ns").set("test", "value");

    expect(Redis.set.mock.calls).toHaveLength(1);
    expect(Redis.set.mock.calls[0]).toEqual(["ns//test", JSON.stringify("value")]);
  });

  test("given ttl when set then appropriate funcion called", async () => {
    await cache("ns").set("test", "value", 5);

    expect(Redis.set.mock.calls).toHaveLength(1);
    expect(Redis.set.mock.calls[0]).toEqual(["ns//test", JSON.stringify("value"), "EX", 5]);
  });

  test("given no value when get then appropriate function called and return null", async () => {
    const get = (Redis.prototype.get = jest.fn(() => null));

    const result = await cache("ns").get("test");

    expect(!result);
    expect(get.mock.calls).toHaveLength(1);
    expect(get.mock.calls[0]).toEqual(["ns//test"]);
  });

  test("given value exists when get then appropriate function called and return value correct", async () => {
    const get = (Redis.prototype.get = jest.fn(() => '"value"'));

    const result = await cache("ns").get("test");

    expect(result).toBe("value");
    expect(get.mock.calls).toHaveLength(1);
    expect(get.mock.calls[0]).toEqual(["ns//test"]);
  });

  test("given value exists when delete then correct method called", async () => {
    const del = (Redis.prototype.del = jest.fn(() => null));

    await cache("ns").delete("test");

    expect(del.mock.calls).toHaveLength(1);
    expect(del.mock.calls[0]).toEqual(["ns//test"]);
  });
});
