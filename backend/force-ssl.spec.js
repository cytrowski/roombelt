jest.mock("./config");
const config = require("./config");
const forceSsl = require("./force-ssl");

const mockNext = jest.fn(() => {
});
const mockRes = {
  redirect: jest.fn(() => {
  })
};

test("given not forcing ssl when called then next and no redirection", () => {
  config.forceHttps = false;

  forceSsl(null, null, mockNext);

  expect(mockNext.mock.calls).toHaveLength(1);
});

test("given force https and protocol is https when called then call next and no redirection", () => {
  config.forceHttps = true;
  const mockReq = { headers: { "x-forwarded-proto": "https" } };

  forceSsl(mockReq, null, mockNext);

  expect(mockNext.mock.calls).toHaveLength(1);
});

test("given https forced and protocol is http when call then redirect to https", () => {
  config.forceHttps = true;
  const mockReq = {
    headers: {
      "x-forwarded-proto": "http",
      host: "ww.somehost.com"
    },
    url: "/some/url"
  };

  forceSsl(mockReq, mockRes, mockNext);

  expect(mockNext.mock.calls).toHaveLength(0);
  expect(mockRes.redirect.mock.calls).toHaveLength(1);
  const redirectArgs = mockRes.redirect.mock.calls[0];
  expect(redirectArgs[0]).toBe("https://ww.somehost.com/some/url");
});
