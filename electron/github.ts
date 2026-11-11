import { createHash } from "node:crypto";
export class RemoteConflict extends Error {}
export class GitHub {
  constructor(
    public repository: string,
    private token: string,
    private transport: typeof fetch = fetch,
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      throw Error("Введите репозиторий в формате owner/repository");
    if (!/^[A-Za-z0-9_]{20,512}$/.test(token)) throw Error("Некорректный токен GitHub");
  }
  async request(
    method: string,
    url: string,
    body?: unknown,
    missing = false,
  ): Promise<any> {
    if (!url.startsWith("/")) throw Error("Недопустимый адрес GitHub");
    let response: Response;
    try {
      response = await this.transport("https://api.github.com" + url, {
        method,
        headers: {
          Authorization: "Bearer " + this.token,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "Veltrite/0.1",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw Error(
        "Не удалось безопасно подключиться к GitHub. Локальные файлы доступны.",
      );
    }
    if (response.status === 404 && missing) return null;
    if ([409, 422].includes(response.status))
      throw new RemoteConflict("Репозиторий изменился. Повторите синхронизацию.");
    if (response.status === 401) throw Error("Вход GitHub истёк. Войдите повторно.");
    if ([403, 429].includes(response.status))
      throw Error(
        "GitHub ограничил запросы или доступ. Проверьте разрешение Contents: Read and write и повторите позже.",
      );
    if (!response.ok)
      throw Error("GitHub отклонил запрос. Проверьте репозиторий и разрешения.");
    const size = Number(response.headers.get("content-length") || 0);
    if (size > 96 * 1024 * 1024) throw Error("Ответ GitHub слишком большой");
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body)
      for await (const chunk of response.body as any) {
        total += chunk.length;
        if (total > 96 * 1024 * 1024) throw Error("Ответ GitHub слишком большой");
        chunks.push(chunk);
      }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  get prefix() {
    return "/repos/" + this.repository;
  }
  async validate(expectedId?: number) {
    const user = await this.request("GET", "/user"),
      repo = await this.request("GET", this.prefix);
    if (
      repo.private !== true ||
      repo.archived !== false ||
      repo.permissions?.push !== true ||
      repo.owner?.id !== user.id ||
      !Number.isSafeInteger(repo.id) ||
      (expectedId !== undefined && repo.id !== expectedId)
    )
      throw Error("Нужен ваш собственный приватный репозиторий с правом записи.");
    return {
      id: repo.id as number,
      account: user.login as string,
      branch: repo.default_branch as string,
    };
  }
  async head(branch: string) {
    try {
      const ref = await this.request(
        "GET",
        this.prefix + "/git/ref/heads/" + encodeURIComponent(branch),
        undefined,
        true,
      );
      return ref?.object?.sha as string | null;
    } catch (e) {
      if (e instanceof RemoteConflict) return null;
      throw e;
    }
  }
  async tree(commit: string) {
    const data = await this.request("GET", this.prefix + "/git/commits/" + commit);
    const tree = await this.request(
      "GET",
      this.prefix + "/git/trees/" + data.tree.sha + "?recursive=1",
    );
    if (tree.truncated || !Array.isArray(tree.tree))
      throw Error("Дерево репозитория слишком большое");
    return {
      treeSha: data.tree.sha as string,
      entries: tree.tree as {
        path: string;
        sha: string;
        type: string;
        mode: string;
      }[],
    };
  }
  async blob(sha: string): Promise<Buffer> {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error("Некорректная ревизия GitHub");
    const data = await this.request("GET", this.prefix + "/git/blobs/" + sha);
    if (
      data.encoding !== "base64" ||
      typeof data.content !== "string" ||
      !Number.isFinite(data.size) ||
      data.size > 48 * 1024 * 1024
    )
      throw Error("Некорректный объект GitHub");
    const bytes = Buffer.from(data.content, "base64");
    if (
      bytes.length !== data.size ||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !==
        sha
    )
      throw Error("Повреждённый объект GitHub");
    return bytes;
  }
  async putBlob(bytes: Buffer) {
    const data = await this.request("POST", this.prefix + "/git/blobs", {
      content: bytes.toString("base64"),
      encoding: "base64",
    });
    const expected = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (data.sha !== expected) throw Error("GitHub не подтвердил запись");
    return data.sha as string;
  }
  async commit(
    branch: string,
    parent: string,
    baseTree: string,
    entries: { path: string; mode: string; type: string; sha: string | null }[],
  ) {
    const tree = await this.request("POST", this.prefix + "/git/trees", {
      base_tree: baseTree,
      tree: entries,
    });
    const commit = await this.request("POST", this.prefix + "/git/commits", {
      message: "Veltrite: зашифрованная синхронизация",
      tree: tree.sha,
      parents: [parent],
    });
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error("GitHub не подтвердил коммит");
    const updated = await this.request(
      "PATCH",
      this.prefix + "/git/refs/heads/" + encodeURIComponent(branch),
      { sha: commit.sha, force: false },
    );
    if (updated.object?.sha !== commit.sha)
      throw Error("GitHub не подтвердил обновление ветки");
    return commit.sha as string;
  }
  async initialize(branch: string) {
    // Contents API безопасно создаёт первый коммит в пустом репозитории.
    await this.request("PUT", this.prefix + "/contents/veltrite-sync/README.md", {
      message: "Veltrite: создание хранилища",
      content: Buffer.from(
        "# Зашифрованное хранилище Veltrite\n\nДанные доступны только с ключом восстановления.\n",
      ).toString("base64"),
      branch,
    });
  }
  async verifyHistory(previous: string | null, current: string) {
    if (!previous || previous === current) return;
    const compare = await this.request(
      "GET",
      this.prefix + "/compare/" + previous + "..." + current,
    );
    if (!["ahead", "identical"].includes(compare.status))
      throw Error(
        "История репозитория была переписана. Автоматический обмен остановлен.",
      );
  }
}
export async function beginDeviceLogin(clientId: string) {
  if (!/^[A-Za-z0-9_.-]{10,100}$/.test(clientId))
    throw Error(
      "В этой сборке не настроен GitHub App. Используйте токен выбранного репозитория.",
    );
  const result = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ client_id: clientId }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const data = (await result.json()) as any;
  if (
    !result.ok ||
    data.verification_uri !== "https://github.com/login/device" ||
    !/^\w{4}-\w{4}$/.test(data.user_code) ||
    typeof data.device_code !== "string" ||
    !Number.isInteger(data.interval) ||
    data.interval < 1 ||
    data.expires_in > 1800
  )
    throw Error("GitHub не выдал корректный код входа");
  return data as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
    expires_in: number;
  };
}
export async function finishDeviceLogin(
  clientId: string,
  code: Awaited<ReturnType<typeof beginDeviceLogin>>,
  signal: AbortSignal,
) {
  let interval = code.interval;
  const end = Date.now() + code.expires_in * 1000;
  while (Date.now() < end) {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(Error("Вход отменён"));
      const onAbort = () => {
        clearTimeout(timer);
        reject(Error("Вход отменён"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, interval * 1000);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: code.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    const data = (await res.json()) as any;
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (data.token_type === "bearer" && typeof data.access_token === "string")
      return data.access_token as string;
    throw Error("Вход отклонён или истёк. Начните снова.");
  }
  throw Error("Время входа истекло");
}
