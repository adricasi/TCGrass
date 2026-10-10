import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { repoPath } from "../server/helpers.js";

const ORIGIN = "https://tcgrass.example";
const source = readFileSync(repoPath("web/public/sw.js"), "utf8");

interface FakeRequest {
  method: string;
  url: string;
  mode: string;
}

type Handler = (event: unknown) => void;
type Network = (url: string) => Promise<Response>;

/** Runs sw.js against in-memory caches and a scripted network. */
function loadWorker(network: Network) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  const keyOf = (request: string | FakeRequest) =>
    new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const fakeFetch = (request: string | FakeRequest) => {
    const url = keyOf(request);
    fetched.push(url);
    return network(url);
  };
  const openStore = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      add: async (request: string) => {
        store.set(keyOf(request), await fakeFetch(request));
      },
      put: (request: string | FakeRequest, response: Response) => {
        store.set(keyOf(request), response);
        return Promise.resolve();
      },
      match: (request: string | FakeRequest) => Promise.resolve(store.get(keyOf(request))?.clone()),
      keys: () => Promise.resolve([...store.keys()].map((url) => ({ url }))),
      delete: (request: string | FakeRequest) => Promise.resolve(store.delete(keyOf(request))),
    };
  };
  const skipWaiting = vi.fn(() => Promise.resolve());
  const claim = vi.fn(() => Promise.resolve());
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting,
    clients: { claim },
  };
  const caches = {
    open: (name: string) => Promise.resolve(openStore(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  };
  runInNewContext(source, {
    self,
    caches,
    fetch: fakeFetch,
    URL,
    Response,
    Promise,
    AbortSignal,
  });

  const lifecycle = async (type: "install" | "activate") => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({ waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    await pending;
  };
  /** Dispatches a fetch; resolves to the worker's response, or undefined if it let it through. */
  const request = async (path: string, init: Partial<FakeRequest> = {}) => {
    let responded: Promise<Response> | undefined;
    const fakeRequest: FakeRequest = {
      method: "GET",
      url: new URL(path, ORIGIN).href,
      mode: "cors",
      ...init,
    };
    handlers.get("fetch")?.({
      request: fakeRequest,
      respondWith: (promise: Promise<Response>) => (responded = promise),
    });
    return responded === undefined ? undefined : await responded;
  };
  const navigate = (path: string) => request(path, { mode: "navigate" });
  /** Paths stored in the worker's (only) cache. */
  const cachedPaths = () =>
    [...stores.values()].flatMap((store) => [...store.keys()].map((url) => new URL(url).pathname));
  return { lifecycle, request, navigate, stores, fetched, cachedPaths, skipWaiting, claim };
}

const respond = (body: string, type: string, status = 200) =>
  Promise.resolve(new Response(body, { status, headers: { "content-type": type } }));
const html = (body: string) => respond(body, "text/html; charset=utf-8");
const js = (body: string) => respond(body, "text/javascript");
const offline = () => Promise.reject(new TypeError("network down"));

describe("service worker (app shell only)", () => {
  it("AC-013.1 caches the app shell on install and takes over at once", async () => {
    const worker = loadWorker(() => html("<shell>"));
    await worker.lifecycle("install");
    expect(worker.cachedPaths()).toEqual(["/"]);
    expect(worker.skipWaiting).toHaveBeenCalled();
    await worker.lifecycle("activate");
    expect(worker.claim).toHaveBeenCalled();
  });

  it("AC-013.1 deletes caches from older versions on activate", async () => {
    const worker = loadWorker(() => html("<shell>"));
    worker.stores.set("tcgrass-shell-v0", new Map());
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    expect([...worker.stores.keys()]).not.toContain("tcgrass-shell-v0");
    expect(worker.stores.size).toBe(1);
  });

  it("AC-002.10 never intercepts /api or /cards, so per-player answers are never cached", async () => {
    const worker = loadWorker(() => html("{}"));
    expect(await worker.request("/api/me")).toBeUndefined();
    expect(await worker.navigate("/api/binder")).toBeUndefined();
    expect(await worker.request("/cards/everyday-nature/oak")).toBeUndefined();
    expect(worker.fetched).toEqual([]);
  });

  it("AC-013.1 lets non-GET, cross-origin and other navigations through", async () => {
    const worker = loadWorker(() => html("{}"));
    expect(await worker.request("/", { method: "POST", mode: "navigate" })).toBeUndefined();
    expect(await worker.request("https://other.example/x.js")).toBeUndefined();
    expect(await worker.navigate("/healthz")).toBeUndefined();
    expect(await worker.navigate("/icons/icon-512.png")).toBeUndefined();
  });

  it("AC-013.1 loads the shell from the network first, so a redeploy shows at once", async () => {
    let version = "v1";
    const worker = loadWorker(() => html(`<shell ${version}>`));
    await worker.lifecycle("install");
    version = "v2";
    expect(await (await worker.navigate("/"))?.text()).toBe("<shell v2>");
  });

  it("AC-013.1 falls back to the cached shell when the network is down", async () => {
    let network: Network = () => html("<shell>");
    const worker = loadWorker((url) => network(url));
    await worker.lifecycle("install");
    network = offline;
    expect(await (await worker.navigate("/"))?.text()).toBe("<shell>");
  });

  it("AC-013.1 does not replace the cached shell with an error page", async () => {
    let network: Network = () => html("<shell>");
    const worker = loadWorker((url) => network(url));
    await worker.lifecycle("install");
    network = () => respond("bad gateway", "text/plain", 502);
    expect((await worker.navigate("/"))?.status).toBe(502);
    network = offline;
    expect(await (await worker.navigate("/"))?.text()).toBe("<shell>");
  });

  it("AC-013.1 does not replace the cached shell with a non-HTML answer", async () => {
    let network: Network = () => html("<shell>");
    const worker = loadWorker((url) => network(url));
    await worker.lifecycle("install");
    network = () => respond("{}", "application/json");
    await worker.navigate("/");
    network = offline;
    expect(await (await worker.navigate("/"))?.text()).toBe("<shell>");
  });

  it("AC-013.1 serves fingerprinted /assets from the cache after the first load", async () => {
    const worker = loadWorker(() => js("console.log(1)"));
    await worker.request("/assets/index-abc.js");
    const second = await worker.request("/assets/index-abc.js");
    expect(await second?.text()).toBe("console.log(1)");
    expect(worker.fetched.filter((url) => url.endsWith("/assets/index-abc.js"))).toHaveLength(1);
  });

  it("AC-013.1 does not cache a missing asset", async () => {
    const worker = loadWorker(() => respond("not found", "application/json", 404));
    expect((await worker.request("/assets/gone.js"))?.status).toBe(404);
    expect(worker.cachedPaths()).not.toContain("/assets/gone.js");
  });

  it("AC-013.1 drops cached assets the new shell no longer references", async () => {
    let shell = '<script src="/assets/index-a.js"></script>';
    const worker = loadWorker((url) => (url.endsWith("/") ? html(shell) : js("code")));
    await worker.lifecycle("install");
    await worker.request("/assets/index-a.js");
    expect(worker.cachedPaths()).toContain("/assets/index-a.js");

    shell = '<script src="/assets/index-b.js"></script>';
    await worker.navigate("/");
    await worker.request("/assets/index-b.js");
    expect(worker.cachedPaths().sort()).toEqual(["/", "/assets/index-b.js"]);
  });
});
