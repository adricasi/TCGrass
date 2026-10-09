import { Writable } from "node:stream";

import { createApp } from "../../src/server/app.js";
import type { Identification, Identifier, Photo } from "../../src/server/identify/client.js";
import { createLogger } from "../../src/server/logger.js";

export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

/** Collects log lines in memory so tests can assert on them. */
export function memoryLog() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
      done();
    },
  });
  const logger = createLogger({ level: "info", destination });
  return { logger, lines, text: () => lines.join("\n") };
}

/** Fake identifier that records each photo and answers with `answer`. */
export function fakeIdentifier(answer: Identification | (() => Promise<Identification>)) {
  const photos: Photo[] = [];
  const identify: Identifier = async (photo) => {
    photos.push(photo);
    return typeof answer === "function" ? answer() : answer;
  };
  return { identify, photos };
}

export function testApp(identify: Identifier, maxInFlight?: number) {
  const log = memoryLog();
  const app = createApp({
    identify,
    logger: log.logger,
    ...(maxInFlight === undefined ? {} : { maxInFlight }),
  });
  return { app, log };
}

export function photoForm(bytes: Uint8Array, type = "image/jpeg"): FormData {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), "photo.jpg");
  return form;
}
