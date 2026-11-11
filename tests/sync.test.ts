import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { newRecoveryKey } from "../electron/crypto";
import { GitHub } from "../electron/github";
import { synchronize, type SyncCheckpoint } from "../electron/sync";
import { Vault } from "../electron/vault";
class GitHubFixture {
  blobReads = 0;
  privateRepository = true;
  head: string | null = null;
  blobs = new Map<string, Buffer>();
  trees = new Map<string, any[]>();
  commits = new Map<string, { tree: string; parent: string | null }>();
  counter = 1;
  forceRace = false;
  private id() {
    return (this.counter++).toString(16).padStart(40, "0");
  }
  fetch = async (input: any, init: any = {}) => {
    const url = new URL(input),
      route = decodeURIComponent(url.pathname),
      body = init.body ? JSON.parse(init.body) : {},
      method = init.method || "GET";
    let value: any;
    if (url.origin !== "https://api.github.com") throw Error("Credential origin escaped");
    if (init.redirect !== "error") throw Error("Redirect must be blocked");
    if (route === "/user") value = { id: 1, login: "synthetic-user" };
    else if (route === "/repos/synthetic-user/notes")
      value = {
        id: 123,
        private: this.privateRepository,
        archived: false,
        permissions: { push: true },
        owner: { id: 1 },
        default_branch: "main",
      };
    else if (route.includes("/git/ref/heads/")) {
      if (!this.head) return Response.json({}, { status: 404 });
      value = { object: { sha: this.head } };
    } else if (route.includes("/contents/")) {
      const tree = this.id(),
        commit = this.id();
      this.trees.set(tree, []);
      this.commits.set(commit, { tree, parent: null });
      this.head = commit;
      value = {};
    } else if (route.includes("/compare/")) {
      const [previous, current] = route.split("/compare/")[1].split("...");
      let p: string | null = current;
      while (p && p !== previous) p = this.commits.get(p)?.parent || null;
      value = { status: p ? "ahead" : "diverged" };
    } else if (route.includes("/git/blobs")) {
      if (method === "POST") {
        const data = Buffer.from(body.content, "base64"),
          sha = createHash("sha1")
            .update(`blob ${data.length}\0`)
            .update(data)
            .digest("hex");
        this.blobs.set(sha, data);
        value = { sha };
      } else {
        this.blobReads++;
        const sha = route.split("/").pop()!,
          data = this.blobs.get(sha)!;
        value = {
          sha,
          encoding: "base64",
          size: data.length,
          content: data.toString("base64"),
        };
      }
    } else if (route.includes("/git/trees")) {
      if (method === "POST") {
        const entries = [...(this.trees.get(body.base_tree) || [])];
        for (const item of body.tree) {
          const at = entries.findIndex((e) => e.path === item.path);
          if (at >= 0) entries.splice(at, 1);
          if (item.sha) entries.push(item);
        }
        const sha = this.id();
        this.trees.set(sha, entries);
        value = { sha };
      } else
        value = {
          tree: this.trees.get(route.split("/").pop()!),
          truncated: false,
        };
    } else if (route.includes("/git/commits")) {
      if (method === "POST") {
        const sha = this.id();
        this.commits.set(sha, { tree: body.tree, parent: body.parents[0] });
        value = { sha };
      } else {
        const c = this.commits.get(route.split("/").pop()!)!;
        value = { tree: { sha: c.tree } };
      }
    } else if (route.includes("/git/refs/heads/")) {
      expect(body.force).toBe(false);
      if (this.forceRace || this.commits.get(body.sha)?.parent !== this.head) {
        this.forceRace = false;
        return Response.json({}, { status: 422 });
      }
      this.head = body.sha;
      value = { object: { sha: body.sha } };
    } else throw Error("Unexpected API route: " + route);
    return Response.json(value);
  };
  github() {
    return new GitHub(
      "synthetic-user/notes",
      "synthetic_token_with_32_characters",
      this.fetch as any,
    );
  }
}
it("сотни заметок загружаются пакетами без отдельного запроса на каждый файл", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-bulk-"));
  try {
    const aRoot = path.join(temp, "a"),
      bRoot = path.join(temp, "b");
    await fs.mkdir(aRoot);
    await fs.mkdir(bRoot);
    for (let i = 0; i < 120; i++)
      await fs.writeFile(
        path.join(aRoot, `note-${i}.md`),
        "# Идея " + i + "\nСодержимое заметки",
      );
    const a = new Vault(aRoot),
      b = new Vault(bRoot);
    await a.open();
    await b.open();
    const remote = new GitHubFixture(),
      key = newRecoveryKey();
    await synchronize(a, remote.github(), key, null, async () => {});
    const before = remote.blobReads;
    await synchronize(b, remote.github(), key, null, async () => {});
    expect((await b.list()).filter((f) => f.kind === "note")).toHaveLength(120);
    expect(remote.blobReads - before).toBeLessThanOrEqual(3);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
it("отказывается отправлять данные в публичный репозиторий", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-private-"));
  try {
    const vault = new Vault(root);
    await vault.open();
    await vault.create("private.md", "Личная заметка");
    const remote = new GitHubFixture();
    remote.privateRepository = false;
    await expect(
      synchronize(vault, remote.github(), newRecoveryKey(), null, async () => {}),
    ).rejects.toThrow("приватный");
    expect(remote.head).toBeNull();
    expect((await vault.read("private.md")).content).toBe("Личная заметка");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("два клиента обмениваются зашифрованными заметками, вложениями и удалениями", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-sync-"));
  try {
    const aRoot = path.join(temp, "mac"),
      bRoot = path.join(temp, "windows");
    await fs.mkdir(aRoot);
    await fs.mkdir(bRoot);
    const a = new Vault(aRoot),
      b = new Vault(bRoot);
    await a.open();
    await b.open();
    await a.create("Русская папка/Заметка.md", "# Секретная мысль");
    await a.mkdir("Пустая папка");
    await fs.writeFile(path.join(aRoot, "image.png"), Buffer.from([1, 2, 3, 0, 255]));
    const remote = new GitHubFixture(),
      key = newRecoveryKey();
    let ac: SyncCheckpoint | null = null,
      bc: SyncCheckpoint | null = null;
    await synchronize(a, remote.github(), key, ac, async (next) => {
      ac = next;
    });
    expect(
      [...remote.blobs.values()].some((v) => v.includes(Buffer.from("Секретная мысль"))),
    ).toBe(false);
    expect(
      [...remote.trees.values()].flat().some((e) => e.path.includes("Заметка")),
    ).toBe(false);
    await synchronize(b, remote.github(), key, bc, async (next) => {
      bc = next;
    });
    expect((await b.read("Русская папка/Заметка.md")).content).toBe("# Секретная мысль");
    expect(
      (await b.list()).some((f) => f.path === "Пустая папка" && f.kind === "folder"),
    ).toBe(true);
    expect(await fs.readFile(path.join(bRoot, "image.png"))).toEqual(
      Buffer.from([1, 2, 3, 0, 255]),
    );
    const an = await a.read("Русская папка/Заметка.md"),
      bn = await b.read("Русская папка/Заметка.md");
    await a.write(an.path, "Правка Mac", an.revision);
    await b.write(bn.path, "Правка Windows", bn.revision);
    await synchronize(a, remote.github(), key, ac, async (next) => {
      ac = next;
    });
    const conflict = await synchronize(b, remote.github(), key, bc, async (next) => {
      bc = next;
    });
    expect(conflict.conflicts).toContain(an.path);
    expect((await b.list()).filter((f) => f.kind === "note")).toHaveLength(2);
    await synchronize(a, remote.github(), key, ac, async (next) => {
      ac = next;
    });
    expect((await a.list()).filter((f) => f.kind === "note")).toHaveLength(2);
    await a.trash("image.png");
    await synchronize(a, remote.github(), key, ac, async (next) => {
      ac = next;
    });
    await synchronize(b, remote.github(), key, bc, async (next) => {
      bc = next;
    });
    expect((await b.list()).some((f) => f.path === "image.png")).toBe(false);
    expect((await b.trashList()).some((f) => f.path === "image.png")).toBe(true);
    const unchanged = await synchronize(b, remote.github(), key, bc, async (next) => {
      bc = next;
    });
    expect(unchanged.uploaded).toBe(0);
    expect(unchanged.downloaded).toBe(0);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
it("при гонке записи не применяет неподтверждённое удалённое состояние", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-race-"));
  try {
    const vault = new Vault(root);
    await vault.open();
    await vault.create("a.md", "локальная");
    const remote = new GitHubFixture();
    remote.forceRace = true;
    let saved = false;
    await expect(
      synchronize(vault, remote.github(), newRecoveryKey(), null, async () => {
        saved = true;
      }),
    ).rejects.toThrow("изменился");
    expect(saved).toBe(false);
    expect((await vault.read("a.md")).content).toBe("локальная");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
