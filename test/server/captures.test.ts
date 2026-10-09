import { describe, expect, it } from "vitest";

import type { Identification } from "../../src/server/identify/client.js";
import { MAX_PHOTO_BYTES } from "../../src/server/photo.js";
import { captureResponseSchema } from "../../src/shared/schemas/captures.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import { fakeIdentifier, JPEG_BYTES, photoForm, testApp } from "./helpers.js";

const oak: Identification = { outcome: "card", cardId: "oak", confidence: 0.9, flavorLine: "x" };

async function postPhoto(
  app: ReturnType<typeof testApp>["app"],
  auth: Record<string, string>,
  body: FormData | string,
): Promise<Response> {
  return app.request("/api/captures", { method: "POST", headers: auth, body });
}

async function errorCode(response: Response): Promise<string> {
  return errorResponseSchema.parse(await response.json()).error.code;
}

describe("POST /api/captures", () => {
  it("AC-004.2 sends the photo to the identifier and returns the minted card", async () => {
    const model = fakeIdentifier(oak);
    const { app, auth } = testApp(model.identify);

    const response = await postPhoto(app, auth, photoForm(JPEG_BYTES));

    expect(response.status).toBe(200);
    expect(captureResponseSchema.parse(await response.json())).toMatchObject({
      outcome: "card",
      card: { cardId: "oak" },
    });
    expect(model.photos).toHaveLength(1);
    expect(model.photos[0]?.mimeType).toBe("image/jpeg");
    expect(model.photos[0]?.bytes).toEqual(JPEG_BYTES);
  });

  it.each([
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00], "image/png"],
    ["WebP", [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], "image/webp"],
  ])("AC-003.10 accepts a %s photo by its magic bytes", async (_label, bytes, mimeType) => {
    const model = fakeIdentifier(oak);
    const { app, auth } = testApp(model.identify);
    const response = await postPhoto(
      app,
      auth,
      photoForm(new Uint8Array(bytes), "application/octet-stream"),
    );
    expect(response.status).toBe(200);
    expect(model.photos[0]?.mimeType).toBe(mimeType);
  });

  it.each(["none", "screen"] as const)(
    "returns the %s outcome without a card id",
    async (outcome) => {
      const { app, auth } = testApp(fakeIdentifier({ outcome } as Identification).identify);
      const response = await postPhoto(app, auth, photoForm(JPEG_BYTES));
      expect(await response.json()).toEqual({ outcome });
    },
  );

  it("AC-003.9 answers 200 with outcome retry when the model times out or fails", async () => {
    const { app, auth } = testApp(fakeIdentifier({ outcome: "retry", reason: "timeout" }).identify);
    const response = await postPhoto(app, auth, photoForm(JPEG_BYTES));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "retry" });
  });

  it.each([
    ["a GIF", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
    ["a text file posing as a JPEG", new TextEncoder().encode("not really a jpeg")],
    ["an empty file", new Uint8Array()],
  ])("AC-003.10 rejects %s with 415 without calling the model", async (_label, bytes) => {
    const model = fakeIdentifier(oak);
    const { app, auth } = testApp(model.identify);
    const response = await postPhoto(app, auth, photoForm(bytes, "image/jpeg"));
    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe("photo_type");
    expect(model.photos).toHaveLength(0);
  });

  it("AC-003.10 rejects a photo larger than 5 MB with 413 without calling the model", async () => {
    const model = fakeIdentifier(oak);
    const { app, auth } = testApp(model.identify);
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(JPEG_BYTES);
    const response = await postPhoto(app, auth, photoForm(big));
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe("photo_too_large");
    expect(model.photos).toHaveLength(0);
  });

  it("AC-003.10 rejects a request body far over 5 MB with 413 before reading it", async () => {
    const model = fakeIdentifier(oak);
    const { app, auth } = testApp(model.identify);
    const huge = new Uint8Array(MAX_PHOTO_BYTES * 2);
    huge.set(JPEG_BYTES);
    const response = await postPhoto(app, auth, photoForm(huge));
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe("photo_too_large");
    expect(model.photos).toHaveLength(0);
  });

  it("AC-003.10 accepts a photo of exactly 5 MB", async () => {
    const model = fakeIdentifier(oak);
    const { app, auth } = testApp(model.identify);
    const exact = new Uint8Array(MAX_PHOTO_BYTES);
    exact.set(JPEG_BYTES);
    const response = await postPhoto(app, auth, photoForm(exact));
    expect(response.status).toBe(200);
  });

  it("NFR-001 rejects a request without a photo field with 400", async () => {
    const model = fakeIdentifier(oak);
    const { app, auth } = testApp(model.identify);
    const response = await postPhoto(app, auth, "photo=nope");
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("photo_missing");
    expect(model.photos).toHaveLength(0);
  });

  it("AC-003.12 rejects a capture with 503 while 5 identifications are in flight", async () => {
    const pending: (() => void)[] = [];
    const model = fakeIdentifier(
      () =>
        new Promise<Identification>((resolve) => {
          pending.push(() => {
            resolve(oak);
          });
        }),
    );
    const { app, auth } = testApp(model.identify);

    const inFlight = Array.from({ length: 5 }, () => postPhoto(app, auth, photoForm(JPEG_BYTES)));
    await expect.poll(() => model.photos.length).toBe(5);

    const sixth = await postPhoto(app, auth, photoForm(JPEG_BYTES));
    expect(sixth.status).toBe(503);
    expect(await errorCode(sixth)).toBe("busy");
    expect(model.photos).toHaveLength(5);

    pending.forEach((finish) => {
      finish();
    });
    const results = await Promise.all(inFlight);
    expect(results.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);

    const afterwards = postPhoto(app, auth, photoForm(JPEG_BYTES));
    await expect.poll(() => model.photos.length).toBe(6);
    pending.at(-1)?.();
    expect((await afterwards).status).toBe(200);
  });

  it("AC-003.12 rejects uploads beyond the upload cap with 503 before reading the body", async () => {
    const pending: (() => void)[] = [];
    const model = fakeIdentifier(
      () =>
        new Promise<Identification>((resolve) => {
          pending.push(() => {
            resolve(oak);
          });
        }),
    );
    const { app, auth } = testApp(model.identify, { maxUploads: 2 });

    const first = [
      postPhoto(app, auth, photoForm(JPEG_BYTES)),
      postPhoto(app, auth, photoForm(JPEG_BYTES)),
    ];
    await expect.poll(() => model.photos.length).toBe(2);
    const third = await postPhoto(app, auth, photoForm(JPEG_BYTES));
    expect(third.status).toBe(503);
    expect(model.photos).toHaveLength(2);

    pending.forEach((finish) => {
      finish();
    });
    expect((await Promise.all(first)).map((response) => response.status)).toEqual([200, 200]);
  });

  it("AC-003.12 frees the slot when identification throws", async () => {
    const model = fakeIdentifier(() => Promise.reject(new Error("boom")));
    const { app, auth } = testApp(model.identify, { maxInFlight: 1 });
    // A throwing identifier is a "retry" (AC-003.9); the single slot must be free again.
    expect((await postPhoto(app, auth, photoForm(JPEG_BYTES))).status).toBe(200);
    expect((await postPhoto(app, auth, photoForm(JPEG_BYTES))).status).toBe(200);
    expect(model.photos).toHaveLength(2);
  });
});
