import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

const AGENT = fileURLToPath(new URL("../../deploy/droplet/tcgrass-deploy", import.meta.url));
const COMPOSE_WRAPPER = fileURLToPath(
  new URL("../../deploy/droplet/tcgrass-compose", import.meta.url),
);
const REPO = "registry.digitalocean.com/tcgrass/tcgrass-api";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/**
 * Fake `docker`, `iptables` and `mountpoint` that log their arguments (and API_IMAGE for
 * docker) to calls.log, and answer as the STUB_* variables say. jq is the real one.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "tcgrass-agent-"));
  dirs.push(root);
  const bin = join(root, "bin");
  const app = join(root, "app");
  mkdirSync(bin);
  mkdirSync(app);
  const log = join(root, "calls.log");
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub(
    "docker",
    `echo "docker $* | API_IMAGE=\${API_IMAGE:-}" >> "${log}"
case "$*" in
  "buildx imagetools inspect"*) printf '%s' "$STUB_MANIFEST"; exit "\${STUB_INSPECT_EXIT:-0}" ;;
  pull*) exit "\${STUB_PULL_EXIT:-0}" ;;
  "compose run"*) exit "\${STUB_SEED_EXIT:-0}" ;;
  "compose up"*)
    if [[ -n "\${STUB_UP_FAIL_FOR:-}" && "\${API_IMAGE:-}" == "$STUB_UP_FAIL_FOR" ]]; then exit 1; fi
    exit "\${STUB_UP_EXIT:-0}" ;;
esac
exit 0`,
  );
  stub(
    "iptables",
    `echo "iptables $*" >> "${log}"
[[ "$*" == *" -C "* ]] && exit "\${STUB_BLOCK_MISSING:-0}"
exit 0`,
  );
  stub("mountpoint", `exit "\${STUB_NOT_MOUNTED:-0}"`);

  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  const exec = async (stubs: Record<string, string> = {}, script = AGENT, args: string[] = []) => {
    try {
      const { stdout } = await run("bash", [script, ...args], {
        cwd: app,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          IMAGE_REPO: REPO,
          APP_DIR: app,
          MOUNT_POINT: "/mnt/tcgrass",
          STUB_MANIFEST: JSON.stringify({ mediaType: "x", digest: DIGEST_A, size: 1 }),
          ...stubs,
        },
      });
      return { code: 0, stdout };
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      return { code: failure.code, stdout: failure.stdout + failure.stderr };
    }
  };
  const writeEnv = () => writeFileSync(join(app, ".env"), "ACTIVE_EXPANSION=everyday-nature\n");
  const deployed = () =>
    existsSync(join(app, ".deployed-image"))
      ? readFileSync(join(app, ".deployed-image"), "utf8").trim()
      : undefined;
  return { app, calls, exec, writeEnv, deployed };
}

describe("deploy agent (ADR 0008)", () => {
  it("ADR-0008 waits, without touching Docker, until the operator has written .env", async () => {
    const s = sandbox();

    const result = await s.exec();

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("waiting for");
    expect(s.calls().filter((call) => call.startsWith("docker"))).toEqual([]);
  });

  it("ADR-0008 refuses to deploy when the data volume is not mounted", async () => {
    const s = sandbox();
    s.writeEnv();

    const result = await s.exec({ STUB_NOT_MOUNTED: "1" });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("not mounted");
    expect(s.calls().filter((call) => call.startsWith("docker"))).toEqual([]);
  });

  it("ADR-0008 restores the metadata-service block if it is missing", async () => {
    const s = sandbox();

    await s.exec({ STUB_BLOCK_MISSING: "1" });

    expect(s.calls()).toContain("iptables -t raw -I PREROUTING -d 169.254.169.254/32 -j DROP");
  });

  it("ADR-0008 deploys a new release by digest: pull, seed, up --wait, then record it", async () => {
    const s = sandbox();
    s.writeEnv();

    const result = await s.exec();

    const image = `${REPO}@${DIGEST_A}`;
    expect(result.code).toBe(0);
    const docker = s.calls().filter((call) => call.startsWith("docker"));
    expect(docker[0]).toContain(`buildx imagetools inspect ${REPO}:prod`);
    expect(docker[1]).toContain(`pull --quiet ${image}`);
    expect(docker[2]).toMatch(
      new RegExp(
        `^docker compose run --rm --no-deps api .*\\| API_IMAGE=${image.replace(/[@:/.]/g, "\\$&")}$`,
      ),
    );
    expect(docker[3]).toContain("compose up -d --no-build --remove-orphans --wait");
    expect(docker[3]).toContain(`API_IMAGE=${image}`);
    expect(s.deployed()).toBe(image);
  });

  it("ADR-0008 does nothing when :prod still points at the deployed digest", async () => {
    const s = sandbox();
    s.writeEnv();
    await s.exec();

    await s.exec();

    const pulls = s.calls().filter((call) => call.startsWith("docker pull"));
    expect(pulls).toHaveLength(1);
  });

  it("ADR-0008 deploys again when :prod moves to another digest", async () => {
    const s = sandbox();
    s.writeEnv();
    await s.exec();

    await s.exec({ STUB_MANIFEST: JSON.stringify({ digest: DIGEST_B }) });

    expect(s.deployed()).toBe(`${REPO}@${DIGEST_B}`);
  });

  it("ADR-0008 does not record a release whose stack fails to become healthy", async () => {
    const s = sandbox();
    s.writeEnv();

    const result = await s.exec({ STUB_UP_EXIT: "1" });

    expect(result.code).not.toBe(0);
    expect(s.deployed()).toBeUndefined();
  });

  it("ADR-0008 a failed seed leaves the running stack alone and records nothing", async () => {
    const s = sandbox();
    s.writeEnv();

    const result = await s.exec({ STUB_SEED_EXIT: "1" });

    expect(result.code).not.toBe(0);
    expect(s.calls().some((call) => call.startsWith("docker compose up"))).toBe(false);
    expect(s.deployed()).toBeUndefined();
  });

  it("ADR-0008 rolls back to the previous release when a new one fails its health check", async () => {
    const s = sandbox();
    s.writeEnv();
    await s.exec();

    const result = await s.exec({
      STUB_MANIFEST: JSON.stringify({ digest: DIGEST_B }),
      STUB_UP_FAIL_FOR: `${REPO}@${DIGEST_B}`,
    });

    expect(result.code).not.toBe(0);
    expect(s.calls().at(-1)).toMatch(
      new RegExp(`^docker compose up .*API_IMAGE=${REPO}@${DIGEST_A}$`),
    );
    expect(s.deployed()).toBe(`${REPO}@${DIGEST_A}`);
    expect(readFileSync(join(s.app, ".failed-image"), "utf8").trim()).toBe(`${REPO}@${DIGEST_B}`);
  });

  it("ADR-0008 skips a release that already failed until :prod moves again", async () => {
    const s = sandbox();
    s.writeEnv();
    await s.exec();
    const bad = {
      STUB_MANIFEST: JSON.stringify({ digest: DIGEST_B }),
      STUB_UP_FAIL_FOR: `${REPO}@${DIGEST_B}`,
    };
    await s.exec(bad);
    const pullsBefore = s.calls().filter((call) => call.startsWith("docker pull")).length;

    const result = await s.exec(bad);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("already failed");
    expect(s.calls().filter((call) => call.startsWith("docker pull")).length).toBe(pullsBefore);
  });

  it("ADR-0008 stops before pulling when :prod can't be resolved to a digest", async () => {
    const s = sandbox();
    s.writeEnv();

    const result = await s.exec({ STUB_MANIFEST: "not json", STUB_INSPECT_EXIT: "0" });

    expect(result.code).not.toBe(0);
    expect(s.calls().some((call) => call.startsWith("docker pull"))).toBe(false);
  });

  it("ADR-0008 tcgrass-compose runs Compose with the deployed image", async () => {
    const s = sandbox();
    s.writeEnv();
    await s.exec();

    const result = await s.exec({}, COMPOSE_WRAPPER, ["up", "-d", "api"]);

    expect(result.code).toBe(0);
    expect(s.calls().at(-1)).toBe(`docker compose up -d api | API_IMAGE=${REPO}@${DIGEST_A}`);
  });

  it("ADR-0008 tcgrass-compose refuses to run before the first release", async () => {
    const s = sandbox();

    const result = await s.exec({}, COMPOSE_WRAPPER, ["up", "-d"]);

    expect(result.code).not.toBe(0);
    expect(s.calls().some((call) => call.startsWith("docker"))).toBe(false);
  });
});
