/**
 * Entry point of the seed command: `npm run seed -- <expansion-dir> [--placeholders]`
 * (`node dist/server/seed-cli.js …` from the compiled build, as in the container, whose
 * read-only root filesystem rules out npm). Reads DATABASE_PATH from the
 * environment (or `.env`).
 */
import { runSeed } from "./seed.js";

process.exitCode = runSeed(process.argv.slice(2), process.env, {
  log: (line) => {
    console.log(line);
  },
  warn: (line) => {
    console.warn(line);
  },
  error: (line) => {
    console.error(line);
  },
});
